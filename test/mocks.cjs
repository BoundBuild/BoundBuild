/**
 * Mock external services for the BoundBuild end-to-end test.
 * - Port 9099: fake Resend API (POST /v1/emails) — records deliveries to a log file
 * - Port 9100: fake OpenAI-compatible Whisper endpoint (POST /v1/audio/transcriptions)
 * Run via test/e2e.cjs — not for production use.
 */

const http = require('http');
const fs = require('fs');

const LOG = process.env.MOCK_LOG || '/tmp/bb-mock.log';
const TRANSCRIPT = process.env.MOCK_TRANSCRIPT || 'We hit buried rock in the unit three excavation about six hundred mill down. Not on the geotech report at all. Excavator stopped and we need the engineer to come out today. Probably two days delay on the programme.';

function log(line) {
  fs.appendFileSync(LOG, line + '\n');
}

/* ---- fake Resend ---- */
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.method === 'POST' && req.url.startsWith('/v1/emails')) {
      try {
        const data = JSON.parse(body);
        const attachments = (data.attachments || []).map((a) => ({
          filename: a.filename,
          bytes: Math.round((a.content || '').length * 0.75),
          pdfMagic: (a.content || '').startsWith('JVBERi') ? '%PDF' : 'NO',
        }));
        log(JSON.stringify({ type: 'email', to: data.to, from: data.from, subject: data.subject, attachments }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 'mock_' + Date.now() }));
      } catch (e) {
        log(JSON.stringify({ type: 'email-error', error: e.message, raw: body.slice(0, 200) }));
        res.writeHead(400); res.end('{}');
      }
    } else {
      res.writeHead(404); res.end('{}');
    }
  });
}).listen(9099, '127.0.0.1', () => console.log('mock resend on 9099'));

/* ---- fake Whisper ---- */
http.createServer((req, res) => {
  let body = Buffer.alloc(0);
  req.on('data', (c) => (body = Buffer.concat([body, c])));
  req.on('end', () => {
    if (req.method === 'POST' && req.url.startsWith('/v1/audio/transcriptions')) {
      // Parse the multipart body so the e2e test can assert the file was
      // normalized to a clean WAV (filename 'recording.wav', 'RIFF' magic)
      // before being sent to Whisper.
      let filename = null;
      let magic = null;
      const boundaryMatch = (req.headers['content-type'] || '').match(/boundary=(.+)$/);
      if (boundaryMatch) {
        const boundary = boundaryMatch[1].replace(/^"|"$/g, '');
        for (const part of body.toString('latin1').split('--' + boundary)) {
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) continue;
          const header = part.slice(0, headerEnd);
          const content = part.slice(headerEnd + 4);
          const fnMatch = header.match(/filename="([^"]+)"/);
          if (header.includes('name="file"') && fnMatch) {
            filename = fnMatch[1];
            magic = Buffer.from(content.slice(0, 4), 'latin1').toString('latin1');
            break;
          }
        }
      }
      log(JSON.stringify({ type: 'stt', bytes: body.length, filename, magic }));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ text: TRANSCRIPT }));
    } else {
      res.writeHead(404); res.end('{}');
    }
  });
}).listen(9100, '127.0.0.1', () => console.log('mock whisper on 9100'));
