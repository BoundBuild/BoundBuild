/**
 * BoundBuild MVP — API server (Express, zero build step).
 * Routes: auth · projects · capture · AI structuring · events · dispatch · admin · public recipient links
 */

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { load, save, id, now, pushAudit, median, scrubUser, DATA_DIR, UPLOADS_DIR } = require('./store');
const { structureTranscript, structureWithLLM, EVENT_TYPES } = require('./ai');
const { buildEml, sendEmail, emailConfig, dispatchEmail } = require('./mailer');
const { generateEventPdf } = require('./pdf');
const { transcribeAudio } = require('./stt');
const { seed } = require('./seed');

const app = express();
const PORT = process.env.PORT || 8080;

// ---------- boot ----------
seed();
const db = load();

app.use(express.json({ limit: '25mb' }));
app.use('/media', express.static(UPLOADS_DIR));
app.use('/media', express.static(path.join(__dirname, '..', 'public'))); // demo media live in public/demo
app.use(express.static(path.join(__dirname, '..', 'public'), { index: 'index.html' }));

// ---------- auth helpers ----------
function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function newSession(userId) {
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions.push({ token, userId, createdAt: now(), expiresAt: new Date(Date.now() + 30 * 864e5).toISOString() });
  save();
  return token;
}
function setSessionCookie(res, token) {
  res.setHeader('Set-Cookie', `bbsid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`);
}
function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', 'bbsid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
}
function currentUser(req) {
  const token = (req.cookies && req.cookies.bbsid) || (req.headers.authorization || '').replace(/^Bearer /, '');
  if (!token) return null;
  const s = db.sessions.find((x) => x.token === token && new Date(x.expiresAt) > new Date());
  if (!s) return null;
  const u = db.users.find((x) => x.id === s.userId && x.active !== false);
  if (u) u.lastSeenAt = now();
  return u;
}
app.use((req, res, next) => {
  const h = req.headers.cookie;
  if (h) {
    req.cookies = Object.fromEntries(h.split(';').map((x) => x.trim().split(/=(.*)/).slice(0, 2).map((v, i) => i === 1 ? decodeURIComponent(v) : v)));
  } else req.cookies = {};
  next();
});

function requireAuth(req, res, next) {
  const u = currentUser(req);
  if (!u) return res.status(401).json({ error: 'Not signed in' });
  req.user = u;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'Not permitted' });
    next();
  };
}
function companyOf(user) {
  return db.companies.find((c) => c.id === user.companyId);
}
function canSeeCompany(user, companyId) {
  return user.role === 'founder' || user.companyId === companyId;
}
function canSeeEvent(user, evt) {
  if (!evt) return false;
  return canSeeCompany(user, evt.companyId);
}

// ---------- auth routes ----------
app.post('/api/auth/register', (req, res) => {
  const { name, email, password, companyName } = req.body || {};
  if (!name || !email || !password || !companyName) return res.status(400).json({ error: 'Name, email, password and company are required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'An account with this email already exists' });

  const company = { id: id('cmp'), name: companyName, industry: '', pilotStatus: 'active', createdAt: now() };
  db.companies.push(company);
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: id('usr'), name, email: email.toLowerCase(), salt,
    passwordHash: hashPassword(password, salt), role: 'admin',
    companyId: company.id, active: true, createdAt: now(), lastSeenAt: now(),
  };
  db.users.push(user);
  const token = newSession(user.id);
  setSessionCookie(res, token);
  pushAudit('company', company.id, 'Created', `Company ${company.name} registered`, user);
  res.json({ token, user: scrubUser(user) });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const u = db.users.find((x) => x.email.toLowerCase() === String(email || '').toLowerCase());
  if (!u || !u.active) return res.status(401).json({ error: 'Invalid email or password' });
  const hash = hashPassword(password, u.salt);
  if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(u.passwordHash))) return res.status(401).json({ error: 'Invalid email or password' });
  const token = newSession(u.id);
  setSessionCookie(res, token);
  res.json({ token, user: scrubUser(u) });
});

app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.cookies.bbsid || (req.headers.authorization || '').replace(/^Bearer /, '');
  db.sessions = db.sessions.filter((s) => s.token !== token);
  clearSessionCookie(res);
  save();
  res.json({ ok: true });
});

app.get('/api/me', requireAuth, (req, res) => {
  res.json({ user: scrubUser(req.user), company: companyOf(req.user) });
});

// ---------- projects ----------
app.get('/api/projects', requireAuth, (req, res) => {
  const projects = db.projects.filter((p) => canSeeCompany(req.user, p.companyId));
  const counts = {};
  for (const e of db.events) {
    if (canSeeCompany(req.user, e.companyId)) counts[e.projectId] = (counts[e.projectId] || 0) + 1;
  }
  res.json(projects.map((p) => ({ ...p, eventCount: counts[p.id] || 0 })));
});

app.post('/api/projects', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  const { name, location, defaultRecipients } = req.body || {};
  if (!name) return res.status(400).json({ error: 'Project name is required' });
  const project = {
    id: id('prj'), name, location: location || '', companyId: req.user.companyId,
    defaultRecipients: (defaultRecipients || []).map((x) => String(x).trim()).filter(Boolean),
    createdBy: req.user.id, createdAt: now(),
  };
  db.projects.push(project);
  pushAudit('project', project.id, 'Created', `Project ${name}`, req.user);
  save();
  res.json(project);
});

// ---------- uploads (audio + photos) ----------
app.post('/api/upload', requireAuth, express.raw({ type: '*/*', limit: '80mb' }), (req, res) => {
  const kind = req.query.kind === 'audio' ? 'audio' : 'image';
  const ext = (req.query.ext || (kind === 'audio' ? 'webm' : 'jpg')).replace(/[^a-z0-9]/gi, '').slice(0, 8);
  const fileId = id(kind === 'audio' ? 'aud' : 'img');
  const sub = kind === 'audio' ? 'audio' : 'images';
  const dir = path.join(UPLOADS_DIR, sub);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const filename = `${fileId}.${ext}`;
  fs.writeFileSync(path.join(dir, filename), req.body);
  const mime = req.headers['content-type'] || (kind === 'audio' ? 'audio/webm' : 'image/jpeg');
  const media = { id: fileId, eventId: null, kind, filename: `${sub}/${filename}`, mime, size: req.body.length, uploadedBy: req.user.id, createdAt: now() };
  db.media.push(media);
  save();
  res.json({ id: media.id, kind, url: '/media/' + media.filename, size: media.size });
});

app.post('/api/media/attach', requireAuth, (req, res) => {
  const { mediaIds, eventId } = req.body || {};
  for (const m of db.media) {
    if ((mediaIds || []).includes(m.id)) {
      if (m.uploadedBy !== req.user.id) return res.status(403).json({ error: 'Media ownership mismatch' });
      m.eventId = eventId;
    }
  }
  save();
  res.json({ ok: true });
});

// ---------- server-side speech-to-text ----------
app.post('/api/transcribe', requireAuth, async (req, res) => {
  const { mediaId } = req.body || {};
  if (!mediaId) return res.status(400).json({ error: 'mediaId is required' });
  const m = db.media.find((x) => x.id === mediaId);
  if (!m || m.kind !== 'audio') return res.status(400).json({ error: 'Audio media not found' });
  if (m.uploadedBy !== req.user.id && req.user.role === 'user') {
    return res.status(403).json({ error: 'Not your recording' });
  }
  const filePath = path.join(UPLOADS_DIR, String(m.filename));
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Audio file missing on server' });
  const result = await transcribeAudio(filePath, path.basename(m.filename));
  if (result.transcript) {
    m.transcript = result.transcript; m.transcribedAt = now(); m.sttProvider = result.provider;
    save();
  }
  res.json(result);
});

// ---------- AI structuring ----------
app.post('/api/ai/structure', requireAuth, async (req, res) => {
  const { transcript, projectId, eventTypeHint, mediaId } = req.body || {};
  let text = transcript;
  let sttInfo = null;
  // Optional server-side transcription: pass an audio mediaId with no transcript.
  if ((!text || String(text).trim().length < 5) && mediaId) {
    const m = db.media.find((x) => x.id === mediaId && x.kind === 'audio');
    if (!m) return res.status(400).json({ error: 'Audio media not found' });
    const filePath = path.join(UPLOADS_DIR, String(m.filename));
    if (fs.existsSync(filePath)) {
      const r = await transcribeAudio(filePath, path.basename(m.filename));
      sttInfo = r;
      if (r.transcript) { text = r.transcript; m.transcript = r.transcript; m.sttProvider = r.provider; save(); }
    }
  }
  if (!text || String(text).trim().length < 5) {
    return res.status(400).json({ error: 'Voice note text is too short to structure' });
  }
  const project = db.projects.find((p) => p.id === projectId && canSeeCompany(req.user, p.companyId)) || null;

  const llm = await structureWithLLM(String(text).trim(), project);
  const draft = llm || structureTranscript({ transcript: text, project, eventTypeHint });
  res.json({ draft, engine: draft.engine, note: llm ? 'LLM draft' : 'Heuristic draft (offline AI v1)', stt: sttInfo || null });
});

// ---------- capture sessions (instrumentation) ----------
app.post('/api/capture/start', requireAuth, (req, res) => {
  const { projectId } = req.body || {};
  const s = { id: id('cap'), userId: req.user.id, projectId: projectId || null, startedAt: now(), savedAt: null, eventId: null, durationMs: null, abandoned: false };
  db.captureSessions.push(s);
  save();
  res.json(s);
});

// ---------- events ----------
function eventToJson(e) {
  const creator = db.users.find((u) => u.id === e.createdById);
  const reviewer = db.users.find((u) => u.id === e.reviewedById);
  const project = db.projects.find((p) => p.id === e.projectId);
  const media = db.media.filter((m) => m.eventId === e.id);
  const dispatches = db.dispatches.filter((d) => d.eventId === e.id);
  return {
    ...e,
    projectName: project ? project.name : '',
    projectLocation: project ? project.location : '',
    createdByName: creator ? creator.name : 'Unknown',
    reviewedByName: reviewer ? reviewer.name : null,
    media,
    dispatches,
    audit: (e.audit || []).slice().sort((a, b) => a.at.localeCompare(b.at)),
  };
}

app.post('/api/events', requireAuth, (req, res) => {
  const b = req.body || {};
  const project = db.projects.find((p) => p.id === b.projectId && canSeeCompany(req.user, p.companyId));
  if (!project) return res.status(400).json({ error: 'Select a valid project' });
  if (!b.title || !String(b.title).trim()) return res.status(400).json({ error: 'Title is required' });
  if (!EVENT_TYPES.includes(b.type)) return res.status(400).json({ error: 'Invalid event type' });

  const maxRef = Math.max(0, ...db.events.map((x) => parseInt(String(x.ref).replace(/\D/g, ''), 10) || 0));
  db.meta.nextRef = Math.max(db.meta.nextRef || 0, maxRef) + 1;
  const event = {
    id: id('evt'),
    ref: `BB-${String(db.meta.nextRef).padStart(4, '0')}`,
    title: String(b.title).trim(),
    type: b.type,
    projectId: project.id,
    companyId: project.companyId,
    summary: String(b.summary || '').trim(),
    location: String(b.location || '').trim(),
    instructedBy: String(b.instructedBy || '').trim(),
    timeImpact: b.timeImpact || { flag: false, note: '' },
    costImpact: b.costImpact || { flag: false, note: '' },
    notes: String(b.notes || '').trim(),
    status: 'draft',
    ai: b.ai || { used: !!b.ai, confidence: 0, engine: null, draftJson: null },
    fieldsChangedAfterDraft: Number(b.fieldsChangedAfterDraft || 0),
    createdById: req.user.id,
    createdAt: now(), updatedAt: now(),
    sentAt: null, reviewedAt: null, reviewedById: null,
    audit: [{ action: 'Captured', by: { id: req.user.id, name: req.user.name }, at: now(), detail: `${b.mediaIds && b.mediaIds.length ? 'Voice note + ' + b.mediaIds.length + ' photo(s)' : 'Voice note'}` }],
  };
  db.events.push(event);
  for (const m of db.media) if ((b.mediaIds || []).includes(m.id)) m.eventId = event.id;
  if (b.captureSessionId) {
    const s = db.captureSessions.find((x) => x.id === b.captureSessionId);
    if (s) {
      s.savedAt = now(); s.eventId = event.id;
      s.durationMs = Date.now() - new Date(s.startedAt).getTime();
      s.abandoned = false;
    }
  }
  pushAudit('event', event.id, 'Created', `Event ${event.ref} created`, req.user);
  save();
  res.json(eventToJson(event));
});

app.get('/api/events', requireAuth, (req, res) => {
  const { project, status, type, q } = req.query;
  let list = db.events.filter((e) => canSeeCompany(req.user, e.companyId));
  if (project) list = list.filter((e) => e.projectId === project);
  if (status) list = list.filter((e) => e.status === status);
  if (type) list = list.filter((e) => e.type === type);
  if (q) {
    const needle = String(q).toLowerCase();
    list = list.filter((e) => [e.title, e.summary, e.location, e.ref, e.instructedBy].join(' ').toLowerCase().includes(needle));
  }
  list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(list.map(eventToJson));
});

app.get('/api/events/:id', requireAuth, (req, res) => {
  const e = db.events.find((x) => x.id === req.params.id);
  if (!canSeeEvent(req.user, e)) return res.status(404).json({ error: 'Event not found' });
  res.json(eventToJson(e));
});

app.put('/api/events/:id', requireAuth, (req, res) => {
  const e = db.events.find((x) => x.id === req.params.id);
  if (!canSeeEvent(req.user, e)) return res.status(404).json({ error: 'Event not found' });
  const b = req.body || {};
  const changed = [];
  for (const f of ['title', 'type', 'summary', 'location', 'instructedBy', 'notes']) {
    if (b[f] !== undefined && String(b[f]) !== String(e[f] || '')) { e[f] = String(b[f]); changed.push(f); }
  }
  if (b.timeImpact) { e.timeImpact = b.timeImpact; changed.push('timeImpact'); }
  if (b.costImpact) { e.costImpact = b.costImpact; changed.push('costImpact'); }
  if (b.removeMedia && b.removeMedia.length) {
    db.media = db.media.filter((m) => !(b.removeMedia.includes(m.id) && m.eventId === e.id));
    changed.push('media');
  }
  if (b.addMediaIds && b.addMediaIds.length) {
    for (const m of db.media) if (b.addMediaIds.includes(m.id)) m.eventId = e.id;
    changed.push('media');
  }
  e.updatedAt = now();
  if (changed.length) {
    e.audit.push({ action: 'Edited', by: { id: req.user.id, name: req.user.name }, at: now(), detail: changed.join(', ') });
    pushAudit('event', e.id, 'Edited', `Fields: ${changed.join(', ')}`, req.user);
  }
  save();
  res.json(eventToJson(e));
});

async function generateEventPdfSafe(e) {
  try {
    const project = db.projects.find((p) => p.id === e.projectId);
    const creator = db.users.find((u) => u.id === e.createdById);
    return await generateEventPdf(eventToJson(e), {
      project,
      creatorName: creator ? creator.name : '',
      mediaDirs: [UPLOADS_DIR, path.join(__dirname, '..', 'public')],
    });
  } catch (err) {
    console.error('PDF generation failed:', err.message);
    return null;
  }
}

async function performDispatch({ event: e, to, user, isTest = false }) {
  const project = db.projects.find((p) => p.id === e.projectId);
  const token = crypto.randomBytes(16).toString('hex');
  const base = `${process.env.BB_PUBLIC_URL || `http://localhost:${PORT}`}`;
  const recipientLink = `${base}/r/${token}`;

  const creator = db.users.find((u) => u.id === e.createdById);
  const { subject, html } = dispatchEmail({
    event: { ...eventToJson(e), createdByName: creator ? creator.name : '' },
    project, recipientLink, fromName: user.name,
  });

  const pdf = await generateEventPdfSafe(e);
  const attachments = pdf ? [{ filename: `BoundBuild-${e.ref || e.id}.pdf`, contentType: 'application/pdf', content: pdf }] : [];

  const dispatch = { id: id('dsp'), eventId: e.id, to, method: 'email', status: 'queued', token, sentAt: now(), error: null, pdf: !!pdf };
  const result = await sendEmail({ to, subject, html, attachments });
  dispatch.status = result.status;
  if (result.error) dispatch.error = result.error;
  db.dispatches.push(dispatch);
  db.outbox.push({ id: id('out'), dispatchId: dispatch.id, eventId: e.id, to, subject, html, eml: null, sentAt: now(), method: 'email', pdf: !!pdf, provider: result.provider });

  if (!isTest) {
    e.status = 'sent'; e.sentAt = now();
  }
  const detailMap = {
    sent: `(email sent via ${result.provider}${pdf ? ' + PDF' : ''})`,
    failed: `(${result.error ? result.error.slice(0, 120) : 'delivery failed'} — queued in outbox)`,
    queued: '(outbox mode — add RESEND_API_KEY or SMTP_* for live delivery)',
  };
  e.audit.push({
    action: isTest ? 'Test email sent' : 'Dispatched to QS/office',
    by: { id: user.id, name: user.name }, at: now(),
    detail: `${to} ${detailMap[result.status] || ''}`,
  });
  pushAudit('event', e.id, isTest ? 'Test dispatch' : 'Dispatched', `To ${to} via email`, user);
  save();
  return { dispatch, event: eventToJson(e), recipientLink, emailStatus: result.status, provider: result.provider, pdf: !!pdf };
}

app.post('/api/events/:id/dispatch', requireAuth, async (req, res) => {
  const e = db.events.find((x) => x.id === req.params.id);
  if (!canSeeEvent(req.user, e)) return res.status(404).json({ error: 'Event not found' });
  const to = String((req.body || {}).to || '').trim().toLowerCase();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'A valid recipient email is required' });
  const result = await performDispatch({ event: e, to, user: req.user });
  res.json(result);
});

app.get('/api/events/:id/pdf', requireAuth, async (req, res) => {
  const e = db.events.find((x) => x.id === req.params.id);
  if (!canSeeEvent(req.user, e)) return res.status(404).json({ error: 'Event not found' });
  const pdf = await generateEventPdfSafe(e);
  if (!pdf) return res.status(500).json({ error: 'PDF generation failed' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="BoundBuild-${e.ref || e.id}.pdf"`);
  res.send(pdf);
});

// ---------- admin: email configuration + test delivery ----------
app.get('/api/admin/email-status', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  res.json({ ...emailConfig(), pdf: true });
});

app.post('/api/admin/email-test', requireAuth, requireRole('founder', 'admin'), async (req, res) => {
  const to = String((req.body || {}).to || '').trim().toLowerCase();
  if (!to || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return res.status(400).json({ error: 'A valid recipient email is required' });
  const companyIds = req.user.role === 'founder' ? db.companies.map((c) => c.id) : [req.user.companyId];
  const e = db.events
    .filter((x) => companyIds.includes(x.companyId))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (!e) return res.status(400).json({ error: 'No events to use as a test record' });
  const result = await performDispatch({ event: e, to, user: req.user, isTest: true });
  res.json(result);
});

app.post('/api/events/:id/review', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  const e = db.events.find((x) => x.id === req.params.id);
  if (!canSeeEvent(req.user, e)) return res.status(404).json({ error: 'Event not found' });
  e.status = 'reviewed'; e.reviewedAt = now(); e.reviewedById = req.user.id;
  e.audit.push({ action: 'Reviewed', by: { id: req.user.id, name: req.user.name }, at: now(), detail: 'Marked as reviewed in the office' });
  pushAudit('event', e.id, 'Reviewed', 'Reviewed by office', req.user);
  save();
  res.json(eventToJson(e));
});

// ---------- admin: companies / users ----------
app.get('/api/admin/companies', requireAuth, requireRole('founder'), (req, res) => {
  res.json(db.companies.map((c) => ({
    ...c,
    userCount: db.users.filter((u) => u.companyId === c.id).length,
    projectCount: db.projects.filter((p) => p.companyId === c.id).length,
    eventCount: db.events.filter((e) => e.companyId === c.id).length,
  })));
});

app.get('/api/admin/users', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  let list = db.users;
  if (req.user.role !== 'founder') list = list.filter((u) => u.companyId === req.user.companyId);
  res.json(list.map(scrubUser));
});

app.post('/api/admin/users', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  const { name, email, role, password } = req.body || {};
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const companyId = req.user.role === 'founder' ? (req.body.companyId || req.user.companyId) : req.user.companyId;
  if (db.users.some((u) => u.email.toLowerCase() === email.toLowerCase())) return res.status(400).json({ error: 'Email already in use' });
  const salt = crypto.randomBytes(16).toString('hex');
  const user = {
    id: id('usr'), name, email: email.toLowerCase(), salt,
    passwordHash: hashPassword(password, salt),
    role: ['user', 'admin'].includes(role) ? role : 'user',
    companyId, active: true, createdAt: now(), lastSeenAt: null,
  };
  db.users.push(user);
  pushAudit('user', user.id, 'Created', `User ${name} created`, req.user);
  save();
  res.json(scrubUser(user));
});

// ---------- admin: metrics (pilot instrumentation) ----------
app.get('/api/admin/metrics', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  const companyIds = req.user.role === 'founder'
    ? db.companies.map((c) => c.id)
    : [req.user.companyId];
  const inScope = (x) => companyIds.includes(x.companyId);

  const events = db.events.filter(inScope);
  const users = db.users.filter((u) => companyIds.includes(u.companyId));
  const sessions = db.captureSessions.filter((s) => users.some((u) => u.id === s.userId));
  const completed = sessions.filter((s) => s.savedAt);
  const dispatches = db.dispatches.filter((d) => events.some((e) => e.id === d.eventId));

  const weekAgo = Date.now() - 7 * 864e5;
  const eventsLast7 = events.filter((e) => new Date(e.createdAt).getTime() >= weekAgo);
  const active7 = users.filter((u) => u.lastSeenAt && new Date(u.lastSeenAt).getTime() >= weekAgo);

  const usableDrafts = events.filter((e) => e.ai && (e.ai.used || e.fieldsChangedAfterDraft !== undefined) && Number(e.fieldsChangedAfterDraft || 0) <= 2);
  const sent = events.filter((e) => e.sentAt);

  // events per day, last 14 days
  const days = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    days.push({
      label: d.toLocaleDateString('en-NZ', { day: 'numeric', month: 'short' }),
      count: events.filter((e) => { const t = new Date(e.createdAt); return t >= d && t < next; }).length,
    });
  }

  // active users per day, last 14 days
  const activeByDay = days.map((d) => ({ label: d.label, count: 0 }));
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - i);
    const next = new Date(d); next.setDate(d.getDate() + 1);
    activeByDay[13 - i].count = users.filter((u) => {
      const acts = [u.lastSeenAt, ...sessions.filter((s) => s.userId === u.id).map((s) => s.startedAt)];
      return acts.some((a) => a && { start: new Date(a) }.start >= d && { start: new Date(a) }.start < next);
    }).length;
  }

  const byType = {};
  for (const t of EVENT_TYPES) byType[t] = events.filter((e) => e.type === t).length;
  const byStatus = { draft: events.filter((e) => e.status === 'draft').length, sent: events.filter((e) => e.status === 'sent').length, reviewed: events.filter((e) => e.status === 'reviewed').length };

  res.json({
    totals: { events: events.length, users: users.length, projects: db.projects.filter((p) => companyIds.includes(p.companyId)).length, dispatches: dispatches.length },
    metrics: {
      medianCaptureSec: Math.round(median(completed.map((s) => s.durationMs).filter(Boolean)) / 1000),
      completionRate: sessions.length ? Math.round(completed.length / sessions.length * 100) : 0,
      usableDraftRate: events.length ? Math.round(usableDrafts.length / events.length * 100) : 0,
      dispatchRate: events.length ? Math.round(sent.length / events.length * 100) : 0,
      wau: users.length ? Math.round(active7.length / users.length * 100) : 0,
      eventsPerUserWeek: active7.length ? Math.round(eventsLast7.length / active7.length * 10) / 10 : 0,
    },
    days, activeByDay, byType, byStatus,
    recentEvents: events.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8).map(eventToJson),
  });
});

// ---------- admin: outbox ----------
app.get('/api/admin/outbox', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  let list = db.outbox.slice();
  if (req.user.role !== 'founder') {
    const evIds = new Set(db.events.filter((e) => e.companyId === req.user.companyId).map((e) => e.id));
    list = list.filter((o) => evIds.has(o.eventId));
  }
  list.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  res.json(list.map((o) => {
    const e = db.events.find((x) => x.id === o.eventId);
    return { ...o, html: undefined, eml: undefined, eventRef: e ? e.ref : '', eventTitle: e ? e.title : '', hasBody: true, hasPdf: !!o.pdf };
  }));
});

app.get('/api/admin/outbox/:id.eml', requireAuth, requireRole('founder', 'admin'), async (req, res) => {
  const o = db.outbox.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const e = db.events.find((x) => x.id === o.eventId);
  if (!e) return res.status(404).json({ error: 'Event not found' });
  if (req.user.role !== 'founder') {
    if (e.companyId !== req.user.companyId) return res.status(404).json({ error: 'Not found' });
  }
  // Regenerate with the PDF attached so the .eml is always complete.
  const pdf = await generateEventPdfSafe(e);
  const eml = buildEml({
    from: 'BoundBuild <events@boundbuild.app>',
    to: o.to, subject: o.subject, html: o.html,
    attachments: pdf ? [{ filename: `BoundBuild-${e.ref || e.id}.pdf`, contentType: 'application/pdf', content: pdf }] : [],
  });
  res.setHeader('Content-Type', 'message/rfc822');
  res.setHeader('Content-Disposition', `attachment; filename="boundbuild-${o.eventId}.eml"`);
  res.send(eml);
});

app.get('/api/admin/outbox/:id.pdf', requireAuth, requireRole('founder', 'admin'), async (req, res) => {
  const o = db.outbox.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  const e = db.events.find((x) => x.id === o.eventId);
  if (!e) return res.status(404).json({ error: 'Event not found' });
  if (req.user.role !== 'founder') {
    if (e.companyId !== req.user.companyId) return res.status(404).json({ error: 'Not found' });
  }
  const pdf = await generateEventPdfSafe(e);
  if (!pdf) return res.status(500).json({ error: 'PDF generation failed' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="BoundBuild-${e.ref || e.id}.pdf"`);
  res.send(pdf);
});

app.get('/api/admin/outbox/:id.html', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  const o = db.outbox.find((x) => x.id === req.params.id);
  if (!o) return res.status(404).json({ error: 'Not found' });
  res.setHeader('Content-Type', 'text/html');
  res.send(o.html || '<p>No body</p>');
});

// ---------- admin: CSV exports ----------
app.get('/api/admin/export/events.csv', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  const companyIds = req.user.role === 'founder' ? db.companies.map((c) => c.id) : [req.user.companyId];
  const list = db.events.filter((e) => companyIds.includes(e.companyId)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['ref', 'title', 'type', 'project', 'status', 'location', 'instructed_by', 'summary', 'time_impact_flag', 'time_impact_note', 'cost_impact_flag', 'cost_impact_note', 'created_at', 'sent_at', 'reviewed_at', 'created_by', 'fields_changed_after_ai_draft'],
    ...list.map((e) => {
      const p = db.projects.find((x) => x.id === e.projectId);
      const u = db.users.find((x) => x.id === e.createdById);
      return [e.ref, esc(e.title), e.type, esc(p ? p.name : ''), e.status, esc(e.location), esc(e.instructedBy), esc(e.summary), e.timeImpact.flag, esc(e.timeImpact.note), e.costImpact.flag, esc(e.costImpact.note), e.createdAt, e.sentAt || '', e.reviewedAt || '', u ? u.name : '', e.fieldsChangedAfterDraft];
    }),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="boundbuild-events.csv"');
  res.send('\uFEFF' + rows.map((r) => r.join(',')).join('\r\n'));
});

app.get('/api/admin/export/captures.csv', requireAuth, requireRole('founder', 'admin'), (req, res) => {
  const companyIds = req.user.role === 'founder' ? db.companies.map((c) => c.id) : [req.user.companyId];
  const userIds = new Set(db.users.filter((u) => companyIds.includes(u.companyId)).map((u) => u.id));
  const list = db.captureSessions.filter((s) => userIds.has(s.userId)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const esc = (s) => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = [
    ['started_at', 'saved_at', 'duration_ms', 'completed', 'event_id', 'user'],
    ...list.map((s) => {
      const u = db.users.find((x) => x.id === s.userId);
      return [s.startedAt, s.savedAt || '', s.durationMs || '', s.savedAt ? 'yes' : 'no', s.eventId || '', u ? u.name : ''];
    }),
  ];
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="boundbuild-captures.csv"');
  res.send('\uFEFF' + rows.map((r) => r.join(',')).join('\r\n'));
});

// ---------- public recipient link ----------
app.get('/r/:token', (req, res) => {
  const d = db.dispatches.find((x) => x.token === req.params.token);
  if (!d) return res.status(404).send('<h1 style="font-family:sans-serif">Link not found</h1>');
  const e = db.events.find((x) => x.id === d.eventId);
  if (!e) return res.status(404).send('<h1 style="font-family:sans-serif">Record not found</h1>');
  const project = db.projects.find((p) => p.id === e.projectId);
  const creator = db.users.find((u) => u.id === e.createdById);
  const media = db.media.filter((m) => m.eventId === e.id);
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const typeColor = e.type === 'Delay' ? '#FFB020' : e.type === 'Variation' ? '#FF6A00' : '#4CC38A';
  const photos = media.filter((m) => m.kind === 'image').map((m) =>
    `<img src="/media/${m.filename}" style="width:100%;border-radius:10px;margin-bottom:10px;display:block;" />`).join('');
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(e.ref)} · ${esc(e.title)} — BoundBuild</title></head>
<body style="margin:0;background:#0A0C0E;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#F5F7FA;">
<div style="max-width:640px;margin:0 auto;padding:20px;">
  <div style="display:flex;align-items:center;justify-content:space-between;padding:18px 0;border-bottom:1px solid #23282E;">
    <div><span style="background:#FF6A00;color:#0A0C0E;padding:2px 8px;border-radius:6px;font-weight:900;">B</span> <span style="font-weight:800;letter-spacing:0.5px;">BOUNDBUILD</span>
    <div style="color:#9AA3AD;font-size:10px;letter-spacing:2px;">CAPTURE · DOCUMENT · GET PAID</div></div>
    <span style="background:${typeColor}22;color:${typeColor};border:1px solid ${typeColor}55;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;">${esc(e.type.toUpperCase())}</span>
  </div>
  <div style="margin-top:24px;">
    <div style="color:#9AA3AD;font-size:12px;letter-spacing:1.5px;">COMMERCIAL EVENT · ${esc(project ? project.name : '')}</div>
    <h1 style="margin:8px 0 4px;font-size:26px;line-height:1.3;">${esc(e.title)}</h1>
    <div style="color:#9AA3AD;font-size:13px;margin-bottom:24px;">Event ${esc(e.ref)} · captured ${new Date(e.createdAt).toLocaleString('en-NZ')} by ${esc(creator ? creator.name : 'site team')} · status: ${esc(e.status)}</div>
    <div style="background:#131619;border:1px solid #23282E;border-radius:12px;padding:16px;margin-bottom:16px;"><div style="color:#9AA3AD;font-size:11px;letter-spacing:1.5px;margin-bottom:8px;">SUMMARY</div><div style="line-height:1.6;font-size:15px;">${esc(e.summary || '—')}</div></div>
    <div style="background:#131619;border:1px solid #23282E;border-radius:12px;padding:16px;margin-bottom:16px;">
      <div style="color:#9AA3AD;font-size:11px;letter-spacing:1.5px;margin-bottom:10px;">DETAILS</div>
      ${[['Location / area', e.location], ['Instructed by', e.instructedBy]].map(([k, v]) => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1b2026;font-size:14px;"><span style="color:#9AA3AD;">${k}</span><span>${esc(v || '—')}</span></div>`).join('')}
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1b2026;font-size:14px;"><span style="color:#9AA3AD;">Time impact</span><span style="color:${e.timeImpact.flag ? '#FFB020' : '#9AA3AD'};font-weight:600;">${e.timeImpact.flag ? esc(e.timeImpact.note) : 'Not flagged'}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #1b2026;font-size:14px;"><span style="color:#9AA3AD;">Cost impact</span><span style="color:${e.costImpact.flag ? '#FF6A00' : '#9AA3AD'};font-weight:600;">${e.costImpact.flag ? esc(e.costImpact.note) : 'Not flagged'}</span></div>
      <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:14px;"><span style="color:#9AA3AD;">Photos</span><span>${media.filter((m) => m.kind === 'image').length} attached</span></div>
    </div>
    ${photos ? `<div style="margin-bottom:16px;">${photos}</div>` : ''}
    <div style="color:#6B7480;font-size:11px;line-height:1.6;border-top:1px solid #23282E;padding-top:14px;margin-top:8px;">
      Automated commercial event record from BoundBuild — captured in the field by the site team. Verify before relying on it commercially.
    </div>
  </div>
</div></body></html>`);
});

// ---------- health check (for deployment uptime monitoring) ----------
app.get('/api/health', (req, res) => {
  res.json({ ok: true, service: 'boundbuild', version: '0.1.0', time: now() });
});

// ---------- SPA fallback ----------
app.use((req, res, next) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/r/') || req.path.startsWith('/media/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ---------- error handler ----------
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error: ' + err.message });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`BoundBuild MVP running on http://0.0.0.0:${PORT}`);
});
