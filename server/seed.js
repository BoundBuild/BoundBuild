/**
 * Seed data — creates a pilot company with realistic events spread over the
 * last two weeks so every screen and metric has something to show.
 * Run automatically on first boot; safe to re-run (idempotent via meta.seededAt).
 */

const crypto = require('crypto');
const { load, save, id, now } = require('./store');

function hashPassword(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

function daysAgo(days, hour = 9, min = 0) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(hour, min, 0, 0);
  return d.toISOString();
}

function hoursAgo(hours, min = 0) {
  const d = new Date();
  d.setHours(d.getHours() - hours, d.getMinutes() - min, 0, 0);
  return d.toISOString();
}

function seed() {
  const db = load();
  if (db.meta.seededAt) return db;

  const salt = crypto.randomBytes(16).toString('hex');
  const mkUser = (name, email, role, companyId, password = 'boundbuild-demo') => ({
    id: id('usr'), name, email: email.toLowerCase(), salt,
    passwordHash: hashPassword(password, salt),
    role, companyId, active: true, createdAt: daysAgo(40), lastSeenAt: hoursAgo(2),
  });

  const company = {
    id: id('cmp'),
    name: 'Kowhai Construction Ltd',
    industry: 'Commercial & residential builder',
    pilotStatus: 'active',
    createdAt: daysAgo(40),
  };
  db.companies.push(company);

  // Anonymous founder account — identity is generic; password is private (env var,
  // never committed to the repo). Without BB_FOUNDER_PASSWORD a random password is
  // generated so the founder is never left with the public demo password.
  const founderPassword = process.env.BB_FOUNDER_PASSWORD || crypto.randomBytes(18).toString('hex');
  if (!process.env.BB_FOUNDER_PASSWORD) {
    console.warn('⚠  BB_FOUNDER_PASSWORD not set — founder password generated randomly. Set BB_FOUNDER_PASSWORD and reseed to control it.');
  }
  const founder = mkUser('BoundBuild', 'founder@boundbuild.co.nz', 'founder', company.id, founderPassword);
  const mike = mkUser('Chris Taylor', 'foreman1@kowhaiconstruction.co.nz', 'user', company.id);      // foreman
  const pete = mkUser('Sam Wilson', 'foreman2@kowhaiconstruction.co.nz', 'user', company.id);     // foreman
  const jess = mkUser('Alex Morgan', 'qs@kowhaiconstruction.co.nz', 'admin', company.id);   // QS
  db.users.push(founder, mike, pete, jess);

  const p1 = {
    id: id('prj'), name: 'Rimu Ridge Terraces', location: 'Waimakariri, Christchurch',
    companyId: company.id, defaultRecipients: ['qs@kowhaiconstruction.co.nz'],
    createdBy: founder.id, createdAt: daysAgo(35),
  };
  const p2 = {
    id: id('prj'), name: 'Tui Lane Fitout', location: 'Bishopdale, Christchurch',
    companyId: company.id, defaultRecipients: ['qs@kowhaiconstruction.co.nz'],
    createdBy: founder.id, createdAt: daysAgo(30),
  };
  db.projects.push(p1, p2);

  const ev = (o) => ({
    id: id('evt'),
    title: o.title, type: o.type, projectId: o.projectId, companyId: company.id,
    summary: o.summary, location: o.location || '', instructedBy: o.instructedBy || '',
    timeImpact: o.timeImpact || { flag: false, note: '' },
    costImpact: o.costImpact || { flag: false, note: '' },
    notes: o.notes || '', status: o.status || 'draft',
    ai: o.ai || { used: true, confidence: o.confidence ?? 88, engine: 'heuristic-v1', draftJson: null },
    fieldsChangedAfterDraft: o.fieldsChangedAfterDraft ?? 0,
    createdById: o.by, createdAt: o.at, updatedAt: o.at,
    sentAt: o.sentAt || null, reviewedAt: o.reviewedAt || null, reviewedById: o.reviewedById || null,
    ref: o.ref,
    audit: o.audit || [],
  });

  const events = [
    ev({
      ref: 'BB-0001', type: 'Unforeseen condition', by: mike.id, projectId: p1.id,
      at: daysAgo(12, 8, 14), status: 'reviewed', reviewedAt: daysAgo(11, 15, 30), reviewedById: jess.id,
      title: 'Buried slab found in Unit 6 excavation',
      summary: 'While excavating the Unit 6 foundation we struck a buried reinforced concrete slab approximately 600mm below the existing ground level. The slab was not shown on the geotech or the structural drawings. Excavator had to stop, we need direction on removal and any contaminated material. This is an unforeseen condition under the contract.',
      location: 'Unit 6 — foundation zone', instructedBy: 'Structural engineer',
      timeImpact: { flag: true, note: 'Est. 3–5 days (from voice note)' },
      costImpact: { flag: true, note: 'Amount mentioned: $18,500' },
      confidence: 94, fieldsChangedAfterDraft: 1,
      audit: [
        { action: 'Captured', by: { id: mike.id, name: mike.name }, at: daysAgo(12, 8, 14), detail: 'Voice note 0:58 + 2 photos' },
        { action: 'Dispatched to QS', by: { id: mike.id, name: mike.name }, at: daysAgo(12, 9, 2), detail: 'qs@kowhaiconstruction.co.nz' },
        { action: 'Reviewed', by: { id: jess.id, name: jess.name }, at: daysAgo(11, 15, 30), detail: 'Record accepted — added to claim register' },
      ],
    }),
    ev({
      ref: 'BB-0002', type: 'Delay', by: mike.id, projectId: p1.id,
      at: daysAgo(9, 7, 55), status: 'reviewed', reviewedAt: daysAgo(8, 10, 5), reviewedById: jess.id,
      sentAt: daysAgo(9, 8, 40),
      title: 'Wet weather stop — excavation 2 days behind',
      summary: 'Heavy rain overnight flooded the northern excavation trench. We pumped it out this morning but the batter has softened and the geotech wants it benched before we go back in. Two days lost on the critical path. Photos attached show standing water at the north end.',
      location: 'Northern trench — Stage 2', instructedBy: 'Geotech consultant',
      timeImpact: { flag: true, note: 'Est. 2 days (from voice note)' },
      costImpact: { flag: true, note: 'Cost impact flagged in voice note — value to be quantified' },
      confidence: 91, fieldsChangedAfterDraft: 0,
      audit: [
        { action: 'Captured', by: { id: mike.id, name: mike.name }, at: daysAgo(9, 7, 55), detail: 'Voice note 0:41 + 1 photo' },
        { action: 'Dispatched to QS', by: { id: mike.id, name: mike.name }, at: daysAgo(9, 8, 40), detail: 'qs@kowhaiconstruction.co.nz' },
        { action: 'Reviewed', by: { id: jess.id, name: jess.name }, at: daysAgo(8, 10, 5), detail: 'Weather clause — notifying client for EOT' },
      ],
    }),
    ev({
      ref: 'BB-0003', type: 'Site instruction', by: pete.id, projectId: p2.id,
      at: daysAgo(7, 10, 22), status: 'sent', sentAt: daysAgo(7, 11, 5),
      title: 'Verbal instruction — relocate store room partition',
      summary: 'The client representative instructed us on site to move the store room partition wall 400mm east to fit their racking layout. This is a verbal site instruction, the wall is not yet framed so the change is straightforward, but it reduces the store room floor area as built per consent drawings.',
      location: 'Store room — ground floor', instructedBy: 'Client representative',
      timeImpact: { flag: true, note: 'Est. 1 day (from voice note)' },
      costImpact: { flag: false, note: '' },
      confidence: 87, fieldsChangedAfterDraft: 2,
      audit: [
        { action: 'Captured', by: { id: pete.id, name: pete.name }, at: daysAgo(7, 10, 22), detail: 'Voice note 1:02' },
        { action: 'Dispatched to QS', by: { id: pete.id, name: pete.name }, at: daysAgo(7, 11, 5), detail: 'qs@kowhaiconstruction.co.nz' },
      ],
    }),
    ev({
      ref: 'BB-0004', type: 'Material substitution', by: mike.id, projectId: p1.id,
      at: daysAgo(5, 13, 40), status: 'reviewed', reviewedAt: daysAgo(4, 9, 20), reviewedById: jess.id,
      sentAt: daysAgo(5, 14, 12),
      title: 'Timber supply substitution — H3.2 studs out of stock',
      summary: 'Our timber supplier cannot deliver the specified H3.2 treated studs until next week. They have offered a structurally equivalent alternative grade with the same framing schedule. Architect needs to approve the substitution before we continue wall framing. Additional cost is nil, but it affects the programme.',
      location: 'Wall framing — Stages 3–4', instructedBy: 'Architect',
      timeImpact: { flag: true, note: 'Est. 3 days (from voice note)' },
      costImpact: { flag: true, note: 'No additional cost — supplier absorbing' },
      confidence: 90, fieldsChangedAfterDraft: 1,
      audit: [
        { action: 'Captured', by: { id: mike.id, name: mike.name }, at: daysAgo(5, 13, 40), detail: 'Voice note 0:47 + 1 photo' },
        { action: 'Dispatched to QS', by: { id: mike.id, name: mike.name }, at: daysAgo(5, 14, 12), detail: 'qs@kowhaiconstruction.co.nz' },
        { action: 'Reviewed', by: { id: jess.id, name: jess.name }, at: daysAgo(4, 9, 20), detail: 'Requesting supplier substitution docs' },
      ],
    }),
    ev({
      ref: 'BB-0005', type: 'Variation', by: pete.id, projectId: p2.id,
      at: daysAgo(3, 11, 18), status: 'sent', sentAt: daysAgo(3, 11, 52),
      title: 'Extra power outlets — retail tenancy fitout',
      summary: 'Client asked for six additional double power outlets in the retail area plus two data points at the counter. This is extra work outside the consented fitout scope. Need a variation and a price for the electrical subbie. Outlets not on the shop drawings.',
      location: 'Retail floor — service counter', instructedBy: 'Client',
      timeImpact: { flag: true, note: 'Est. 2 days (from voice note)' },
      costImpact: { flag: true, note: 'Cost impact flagged in voice note — value to be quantified' },
      confidence: 92, fieldsChangedAfterDraft: 0,
      audit: [
        { action: 'Captured', by: { id: pete.id, name: pete.name }, at: daysAgo(3, 11, 18), detail: 'Voice note 0:36' },
        { action: 'Dispatched to QS', by: { id: pete.id, name: pete.name }, at: daysAgo(3, 11, 52), detail: 'qs@kowhaiconstruction.co.nz' },
      ],
    }),
    ev({
      ref: 'BB-0006', type: 'Scope change', by: mike.id, projectId: p1.id,
      at: hoursAgo(26, 30), status: 'draft',
      title: 'Additional driveway apron to Unit 4',
      summary: 'The client asked whether we could pour an extra 3 metre driveway apron on Unit 4. Not in the current scope of works. Need to check levels and give them a price. I told them I would flag it with the office today.',
      location: 'Unit 4 — front driveway', instructedBy: 'Client',
      timeImpact: { flag: false, note: '' },
      costImpact: { flag: true, note: 'Cost impact flagged in voice note — value to be quantified' },
      confidence: 85, fieldsChangedAfterDraft: 1,
      audit: [
        { action: 'Captured', by: { id: mike.id, name: mike.name }, at: hoursAgo(26, 30), detail: 'Voice note 0:33' },
      ],
    }),
    ev({
      ref: 'BB-0007', type: 'Site instruction', by: pete.id, projectId: p2.id,
      at: hoursAgo(5, 10), status: 'draft',
      title: 'Fire door hardware change on north exit',
      summary: 'Fire engineer instructed on site that the north exit door hardware must be upgraded to the panic latch spec we priced in the tender. They said the consent drawings show standard lever hardware but their compliance letter requires panic hardware. Flagging before we install so we can price the difference.',
      location: 'North exit door', instructedBy: 'Fire engineer',
      timeImpact: { flag: false, note: '' },
      costImpact: { flag: true, note: 'Cost impact flagged in voice note — value to be quantified' },
      confidence: 89, fieldsChangedAfterDraft: 0,
      audit: [
        { action: 'Captured', by: { id: pete.id, name: pete.name }, at: hoursAgo(5, 10), detail: 'Voice note 0:51' },
      ],
    }),
  ];
  db.events.push(...events);

  // Media — demo photos attached to events
  const media = [
    { id: id('med'), eventId: events[0].id, kind: 'image', filename: 'demo/img-excavation.jpg', mime: 'image/jpeg', size: 0, uploadedBy: mike.id, createdAt: daysAgo(12, 8, 16) },
    { id: id('med'), eventId: events[1].id, kind: 'image', filename: 'demo/img-wetsite.jpg', mime: 'image/jpeg', size: 0, uploadedBy: mike.id, createdAt: daysAgo(9, 7, 57) },
    { id: id('med'), eventId: events[3].id, kind: 'image', filename: 'demo/img-timber.jpg', mime: 'image/jpeg', size: 0, uploadedBy: mike.id, createdAt: daysAgo(5, 13, 42) },
  ];
  db.media.push(...media);

  // Capture sessions (instrumentation)
  const sessions = [];
  const s = (user, projectId, startedAt, savedAt) => ({
    id: id('cap'), userId: user.id, projectId, startedAt,
    savedAt: savedAt || null, eventId: savedAt ? null : null, durationMs: null, abandoned: !savedAt,
  });
  // Completed sessions matching saved events
  sessions.push(
    { ...s(mike, p1.id, daysAgo(12, 8, 13, 50), daysAgo(12, 8, 14, 14)), durationMs: 24_000 },
    { ...s(mike, p1.id, daysAgo(9, 7, 54, 30), daysAgo(9, 7, 55, 11)), durationMs: 41_000 },
    { ...s(pete, p2.id, daysAgo(7, 10, 21, 40), daysAgo(7, 10, 22, 22)), durationMs: 42_000 },
    { ...s(mike, p1.id, daysAgo(5, 13, 39, 20), daysAgo(5, 13, 40, 7)), durationMs: 47_000 },
    { ...s(pete, p2.id, daysAgo(3, 11, 17, 30), daysAgo(3, 11, 18, 18)), durationMs: 48_000 },
    { ...s(mike, p1.id, hoursAgo(27, 0), hoursAgo(26, 30)), durationMs: 30_000 },
    { ...s(pete, p2.id, hoursAgo(6, 0), hoursAgo(5, 10)), durationMs: 50_000 },
    // Abandoned captures (drop-off measurement)
    { ...s(mike, p1.id, daysAgo(2, 14, 5), null) },
    { ...s(pete, p2.id, hoursAgo(30, 0), null) },
  );
  db.captureSessions.push(...sessions);
  // Link completed sessions to their events
  const byTimes = [...db.events].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const done = db.captureSessions.filter((x) => x.savedAt).sort((a, b) => a.savedAt.localeCompare(b.savedAt));
  for (let i = 0; i < Math.min(done.length, byTimes.length); i++) done[i].eventId = byTimes[i].id;

  // Dispatches + outbox for the sent/reviewed events
  for (const e of db.events.filter((x) => x.sentAt)) {
    const token = crypto.randomBytes(16).toString('hex');
    db.dispatches.push({
      id: id('dsp'), eventId: e.id, to: 'qs@kowhaiconstruction.co.nz', method: 'email',
      status: 'sent', token, sentAt: e.sentAt, error: null,
    });
    db.outbox.push({
      id: id('out'), dispatchId: db.dispatches[db.dispatches.length - 1].id, eventId: e.id,
      to: 'qs@kowhaiconstruction.co.nz',
      subject: `[BoundBuild] ${e.type} — ${e.title}`,
      html: '<seeded>', eml: '<seeded>', sentAt: e.sentAt, method: 'email',
    });
  }

  db.meta.seededAt = now();
  save();
  console.log('✔ Seeded demo data:', db.companies.length, 'company,', db.users.length, 'users,', db.events.length, 'events,', db.captureSessions.length, 'capture sessions');
  return db;
}

module.exports = { seed };
