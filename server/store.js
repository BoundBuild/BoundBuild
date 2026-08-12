/**
 * BoundBuild MVP — JSON file datastore.
 * Deliberately dependency-free and single-process for pilot scale.
 * Upgrade path: PostgreSQL (see README) when multi-instance is needed.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.BB_DATA_DIR
  ? path.resolve(process.env.BB_DATA_DIR)
  : path.join(__dirname, '..', 'data');
const UPLOADS_DIR = process.env.BB_UPLOADS_DIR
  ? path.resolve(process.env.BB_UPLOADS_DIR)
  : path.join(__dirname, '..', 'uploads');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const DEFAULT_DB = () => ({
  meta: { schemaVersion: 1, seededAt: null },
  companies: [],      // {id, name, industry, pilotStatus, createdAt, users:[], projects:[]}
  users: [],          // {id, name, email, passwordHash, salt, role, companyId, active, createdAt, lastSeenAt}
  sessions: [],       // {token, userId, createdAt, expiresAt}
  projects: [],       // {id, name, location, companyId, defaultRecipients:[], createdBy, createdAt}
  events: [],         // {id, title, type, projectId, companyId, summary, location, instructedBy,
                      //  timeImpact:{flag,note}, costImpact:{flag,note}, notes, status, ai:{used,confidence,draftJson},
                      //  fieldsChangedAfterDraft, createdById, createdAt, updatedAt, sentAt, reviewedAt, reviewedById, audit:[]}
  media: [],          // {id, eventId, kind:'audio'|'image', filename, mime, size, uploadedBy, createdAt}
  dispatches: [],     // {id, eventId, to, method:'email'|'link', status:'queued'|'sent'|'failed', token, sentAt, error}
  captureSessions: [],// {id, userId, projectId, startedAt, savedAt, eventId, durationMs, abandoned}
  outbox: [],         // {id, dispatchId, eventId, to, subject, html, eml, sentAt, method}
  audit: [],          // {id, entity, entityId, action, detail, by, at}
});

let db = null;

function load() {
  if (db) return db;
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o755 });
  if (fs.existsSync(DB_FILE)) {
    try {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      // defensive migration: fill any keys missing from older db files
      const defaults = DEFAULT_DB();
      for (const k of Object.keys(defaults)) if (db[k] === undefined) db[k] = defaults[k];
      return db;
    } catch (e) {
      console.error('DB corrupt, starting fresh:', e.message);
    }
  }
  db = DEFAULT_DB();
  save();
  return db;
}

function save() {
  if (!db) return;
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function id(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}

function now() {
  return new Date().toISOString();
}

function pushAudit(entity, entityId, action, detail, by) {
  db.audit.push({
    id: id('aud'),
    entity, entityId, action, detail,
    by: by ? { id: by.id, name: by.name } : null,
    at: now(),
  });
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

function scrubUser(u) {
  if (!u) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role, companyId: u.companyId, active: u.active, createdAt: u.createdAt, lastSeenAt: u.lastSeenAt };
}

module.exports = { load, save, id, now, pushAudit, median, scrubUser, DATA_DIR, UPLOADS_DIR };
