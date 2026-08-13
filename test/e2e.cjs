/**
 * BoundBuild — full-pipeline end-to-end test with mocked external services.
 *
 * Proves the REAL stack end-to-end: auth → audio upload → server-side STT
 * (mock Whisper) → AI structuring → event persistence → dispatch with PDF
 * attachment through a fake Resend → email-status + .eml + PDF downloads.
 *
 * Run:  npm run test:e2e   (no API keys required — external services are mocked)
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const APP_PORT = 8181;
const BASE = `http://127.0.0.1:${APP_PORT}`;
const TMP = '/tmp/bb-e2e';
const MOCK_LOG = path.join(TMP, 'mock.log');

let failures = 0;
const ok = (name, cond, extra = '') => {
  console.log((cond ? '✔' : '✘ FAIL') + ' ' + name + (extra ? ' — ' + extra : ''));
  if (!cond) failures++;
};

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/** Build a minimal valid WAV file (16-bit PCM sine tone) as a Buffer. */
function buildTestWav(sampleRate, seconds) {
  const numSamples = Math.floor(sampleRate * seconds);
  const dataSize = numSamples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);      // fmt chunk size
  buf.writeUInt16LE(1, 20);       // PCM
  buf.writeUInt16LE(1, 22);       // mono
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 2, 28); // byte rate
  buf.writeUInt16LE(2, 32);       // block align
  buf.writeUInt16LE(16, 34);      // bits per sample
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < numSamples; i++) {
    const s = Math.round(3000 * Math.sin(2 * Math.PI * 440 * i / sampleRate));
    buf.writeInt16LE(s, 44 + i * 2);
  }
  return buf;
}
async function waitFor(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.status < 500) return true; // any response (even 401) means the server is up
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  return false;
}

(async () => {
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(TMP, { recursive: true });

  /* --- start mock services --- */
  const mocks = spawn('node', ['test/mocks.cjs'], { cwd: ROOT, env: { ...process.env, MOCK_LOG }, stdio: ['ignore', 'pipe', 'pipe'] });
  /* --- start app server pointed at the mocks --- */
  const app = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(APP_PORT),
      BB_DATA_DIR: path.join(TMP, 'data'),
      BB_UPLOADS_DIR: path.join(TMP, 'uploads'),
      RESEND_API_KEY: 're_test_123',                                   // any value — mock validates the path
      RESEND_API_URL: 'http://127.0.0.1:9099/v1',
      RESEND_FROM: 'BoundBuild <events@boundbuild.app>',
      STT_PROVIDER: 'whisper',
      OPENAI_API_KEY: 'sk_test_123',
      STT_URL: 'http://127.0.0.1:9100/v1/audio/transcriptions',
      STT_MODEL: 'whisper-1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let appLog = '';
  app.stdout.on('data', (d) => (appLog += d));

  try {
    if (!(await waitFor(BASE + '/api/me'))) throw new Error('app server did not start');
    const j = async (method, p, body, token) => {
      const r = await fetch(BASE + p, {
        method,
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: r.status, data: await r.json().catch(() => ({})) };
    };

    /* 1. auth */
    const login = await j('POST', '/api/auth/login', { email: 'foreman1@kowhaiconstruction.co.nz', password: 'boundbuild-demo' });
    ok('login issues a real session token', login.status === 200 && !!login.data.token);
    const token = login.data.token;
    // admin endpoints need a founder/admin session (role enforcement is real)
    const jessLogin = await j('POST', '/api/auth/login', { email: 'qs@kowhaiconstruction.co.nz', password: 'boundbuild-demo' });
    const adminToken = jessLogin.data.token;
    const jAdmin = (method, p, body) => j(method, p, body, adminToken);

    /* 2. audio upload → server-side STT */
    // Build a real (valid) WAV in JS — a sine tone. Deliberately upload it
    // mislabelled as .webm: the server's ffmpeg normalization must convert it
    // to a clean WAV before Whisper sees it.
    const wav = buildTestWav(16000, 0.5);
    const upRes = await fetch(`${BASE}/api/upload?kind=audio&ext=webm`, {
      method: 'POST',
      headers: { 'Content-Type': 'audio/webm', Authorization: 'Bearer ' + token },
      body: Buffer.from(wav),
    });
    const up = await upRes.json();
    ok('audio upload persisted', upRes.status === 200 && !!up.id && up.kind === 'audio', up.url || '');
    ok('audio file on disk', fs.existsSync(path.join(TMP, 'uploads', 'audio', up.id + '.webm')));

    const tr = await jAdmin('POST', '/api/transcribe', { mediaId: up.id });
    ok('server-side STT transcribed the audio (mock Whisper)', tr.status === 200 && !!tr.data.transcript, `provider=${tr.data.provider}`);
    ok('STT transcript is meaningful', (tr.data.transcript || '').includes('buried rock'));

    /* 3. AI structuring on the server transcript */
    const st = await jAdmin('POST', '/api/ai/structure', { transcript: tr.data.transcript });
    ok('AI structuring produced a draft', st.status === 200 && !!st.data.draft.title);
    ok('type detected: ' + st.data.draft.type, st.data.draft.type === 'Unforeseen condition');
    ok('time impact flagged', st.data.draft.timeImpact && st.data.draft.timeImpact.flag === true);
    ok('instructed-by detected: ' + st.data.draft.instructedBy, st.data.draft.instructedBy === 'Engineer');

    /* 4. event creation + persistence */
    const projects = await jAdmin('GET', '/api/projects');
    const evt = await jAdmin('POST', '/api/events', {
      title: st.data.draft.title, type: st.data.draft.type, projectId: projects.data[0].id,
      summary: st.data.draft.summary, location: st.data.draft.location || 'Unit 3 excavation',
      instructedBy: st.data.draft.instructedBy || 'Engineer',
      timeImpact: st.data.draft.timeImpact, costImpact: st.data.draft.costImpact,
      mediaIds: [up.id], fieldsChangedAfterDraft: 1,
      ai: { used: true, confidence: st.data.draft.confidence, engine: st.data.draft.engine },
    });
    ok('event created', evt.status === 200 && /^BB-\d{4}/.test(evt.data.ref || ''), evt.data.ref);
    ok('event persisted to db.json', fs.readFileSync(path.join(TMP, 'data', 'db.json'), 'utf8').includes(evt.data.id));

    /* 5. dispatch → real email path (mock Resend) */
    const dsp = await jAdmin('POST', `/api/events/${evt.data.id}/dispatch`, { to: 'qs@pilotbuilder.co.nz' });
    ok('dispatch executed', dsp.status === 200);
    ok('email delivered via provider', dsp.data.emailStatus === 'sent', `provider=${dsp.data.provider}`);
    ok('PDF attached to dispatch', dsp.data.pdf === true);

    const mockLog = fs.readFileSync(MOCK_LOG, 'utf8');
    const emailLine = mockLog.split('\n').filter((l) => l.includes('"type":"email"')).pop();
    ok('mock Resend received the email', !!emailLine, (emailLine || '').slice(0, 90));
    if (emailLine) {
      const parsed = JSON.parse(emailLine);
      ok('email to correct recipient', (parsed.to || []).includes('qs@pilotbuilder.co.nz'));
      ok('email subject carries event type + title', (parsed.subject || '').includes('BoundBuild') && (parsed.subject || '').includes('Unforeseen condition'));
      ok('email carried 1 PDF attachment', parsed.attachments && parsed.attachments.length === 1, JSON.stringify(parsed.attachments));
      ok('attachment is a real PDF (%PDF magic)', parsed.attachments && parsed.attachments[0].pdfMagic === '%PDF');
    }
    const sttLine = mockLog.split('\n').filter((l) => l.includes('"type":"stt"')).pop();
    ok('mock Whisper received audio', !!sttLine);
    if (sttLine) {
      const sp = JSON.parse(sttLine);
      ok('audio was normalized to WAV before Whisper (ffmpeg fix)', sp.filename === 'recording.wav' && sp.magic === 'RIFF', JSON.stringify(sp));
    }

    /* 6. PDF endpoint + .eml with attachment */
    const pdfRes = await fetch(`${BASE}/api/events/${evt.data.id}/pdf`, { headers: { Authorization: 'Bearer ' + token } });
    const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
    ok('event PDF downloads', pdfRes.status === 200 && pdfBuf.length > 1500, pdfBuf.length + ' bytes');
    ok('PDF has correct magic bytes', pdfBuf.slice(0, 4).toString() === '%PDF');

    const outbox = await jAdmin('GET', '/api/admin/outbox');
    ok('outbox lists the dispatch', outbox.status === 200 && outbox.data.length >= 1 && outbox.data[0].hasPdf === true);
    const emlRes = await fetch(`${BASE}/api/admin/outbox/${outbox.data[0].id}.eml`, { headers: { Authorization: 'Bearer ' + adminToken } });
    const eml = await emlRes.text();
    ok('.eml is multipart with PDF attachment', eml.includes('multipart/mixed') && eml.includes('application/pdf') && eml.includes('JVBERi'));

    /* 7. email status + test delivery */
    const est = await jAdmin('GET', '/api/admin/email-status');
    ok('email-status reports resend configured', est.data && est.data.provider === 'resend' && est.data.configured === true);
    const before = await jAdmin('GET', '/api/events');
    const test = await jAdmin('POST', '/api/admin/email-test', { to: 'qs@pilotbuilder.co.nz' });
    ok('admin test email delivered', test.data && test.data.emailStatus === 'sent');
    const after = await jAdmin('GET', '/api/events');
    ok('test email did not change event status', JSON.stringify(before.data.map((e) => e.status)) === JSON.stringify(after.data.map((e) => e.status)));

    /* 8. cookie auth set for direct downloads */
    const loginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'qs@kowhaiconstruction.co.nz', password: 'boundbuild-demo' }),
      redirect: 'manual',
    });
    ok('login sets session cookie', (loginRes.headers.get('set-cookie') || '').includes('bbsid='));
    const cookie = loginRes.headers.get('set-cookie').split(';')[0];
    const pdfRes2 = await fetch(`${BASE}/api/events/${evt.data.id}/pdf`, { headers: { Cookie: cookie } });
    ok('PDF route works with cookie auth (browser <a href> downloads)', pdfRes2.status === 200);
  } catch (e) {
    console.error('E2E ERROR:', e.message);
    console.error(appLog.slice(-1500));
    failures++;
  } finally {
    app.kill('SIGTERM'); mocks.kill('SIGTERM');
    await sleep(400);
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(failures ? `\n${failures} FAILURE(S)` : '\nE2E PIPELINE PASSED — real stack, mocked providers');
    process.exit(failures ? 1 : 0);
  }
})();
