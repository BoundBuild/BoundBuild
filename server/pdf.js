/**
 * BoundBuild MVP — branded Commercial Event Record PDF (A4).
 * The exact artifact the QS receives: project, ref, evidence, AI summary,
 * impacts, photos, submitter, status, audit trail.
 */

const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const W = 595, H = 842, M = 42;
const C = {
  black: '#0A0C0E', surface: '#131619', border: '#D8DDE3', bg: '#F4F6F8',
  text: '#1B1F24', muted: '#6B7480', faint: '#9AA3AD',
  orange: '#FF6A00', amber: '#B97F00', green: '#1E9E63', blue: '#2B6CB0',
};

function typeColor(type) {
  return {
    'Variation': C.orange, 'Delay': C.amber, 'Site instruction': C.green,
    'Scope change': C.blue, 'Unforeseen condition': '#7B4FC0',
    'Material substitution': '#0E8F8F',
  }[type] || C.muted;
}
function statusColor(s) {
  return { draft: C.muted, sent: C.amber, reviewed: C.green }[s] || C.muted;
}
function labelTextColor(fill) {
  return (fill === C.orange || fill === C.amber) ? '#0A0C0E' : '#FFFFFF';
}
function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}
function escPdf(s) { return String(s ?? ''); }

/**
 * @param {object} ev - event in eventToJson shape (with media, audit, projectName…)
 * @param {object} opts - { project, creatorName, mediaDirs: [abs paths] }
 * @returns {Promise<Buffer>}
 */
function generateEventPdf(ev, { project, creatorName, mediaDirs = [] } = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4', margin: 0, bufferPages: true,
      info: {
        Title: `${ev.ref || 'Event'} — ${ev.title || ''}`,
        Author: 'BoundBuild', Creator: 'BoundBuild MVP',
        Subject: 'Commercial Event Record',
      },
    });
    const bufs = [];
    doc.on('data', (b) => bufs.push(b));
    doc.on('end', () => resolve(Buffer.concat(bufs)));
    doc.on('error', reject);

    let y = 128;
    const ensure = (need) => {
      if (y + need > H - 70) { doc.addPage(); y = 60; }
    };

    /* ---------- footer on every page ---------- */
    const drawFooter = () => {
      doc.rect(0, H - 44, W, 44).fill(C.black);
      doc.fillColor('#8A94A0').font('Helvetica').fontSize(7.5)
        .text(`BoundBuild MVP · Generated ${new Date().toISOString().slice(0, 10)} · ${ev.ref || ''} · Draft records captured in the field — verify before relying on them commercially`, M, H - 37, { width: W - 2 * M });
      doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(7.5)
        .text('CAPTURE · DOCUMENT · GET PAID', M, H - 26, { width: W - 2 * M, align: 'right' });
    };
    doc.on('pageAdded', () => drawFooter());

    /* ---------- header ---------- */
    doc.rect(0, 0, W, 108).fill(C.black);
    doc.rect(M, 24, 46, 46).fill(C.orange);
    doc.fillColor('#0A0C0E').font('Helvetica-Bold').fontSize(30).text('B', M + 12, 28);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(21).text('BOUNDBUILD', M + 66, 28);
    doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(8)
      .text('CAPTURE · DOCUMENT · GET PAID', M + 66, 55, { characterSpacing: 1.2 });
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(10.5)
      .text('COMMERCIAL EVENT RECORD', W - M - 200, 30, { width: 200, align: 'right', characterSpacing: 1.5 });
    doc.fillColor(C.orange).font('Helvetica-Bold').fontSize(19)
      .text(ev.ref || '', W - M - 200, 48, { width: 200, align: 'right' });

    const chip = (x, w, label, fill) => {
      doc.roundedRect(x, 80, w, 19, 9.5).fill(fill);
      doc.fillColor(labelTextColor(fill)).font('Helvetica-Bold').fontSize(8)
        .text(String(label).toUpperCase(), x + 9, 85.5, { characterSpacing: 0.8 });
    };
    chip(M, 168, ev.type || 'Event', typeColor(ev.type));
    const stw = 96;
    chip(W - M - stw, stw, ev.status || 'draft', statusColor(ev.status));

    /* ---------- body helpers ---------- */
    const label = (t, x, yy, color) => {
      doc.fillColor(color || C.muted).font('Helvetica-Bold').fontSize(7.5)
        .text(String(t).toUpperCase(), x, yy, { characterSpacing: 0.7 });
    };
    const value = (t, x, yy, w, size, color, opts = {}) => {
      doc.fillColor(color || C.text).font('Helvetica').fontSize(size || 10.5)
        .text(escPdf(t), x, yy, { width: w, lineGap: 2.5, ...opts });
    };

    /* ---------- event title ---------- */
    ensure(70);
    doc.font('Helvetica-Bold').fontSize(17).fillColor(C.text)
      .text(escPdf(ev.title || 'Untitled event'), M, y, { width: W - 2 * M });
    y += doc.heightOfString(ev.title || 'Untitled event', { width: W - 2 * M }) + 8;
    doc.moveTo(M, y).lineTo(W - M, y).strokeColor(C.border).lineWidth(1).stroke();
    y += 16;

    /* ---------- project & evidence ---------- */
    const rowW = (W - 2 * M) / 2 - 12;
    const evidenceRow = (l1, v1, l2, v2) => {
      label(l1, M, y); value(v1, M + 118, y, W - M - 118 - rowW - 24, 10.5);
      label(l2, M + rowW + 24, y); value(v2, M + rowW + 24 + 118, y, rowW - 118, 10.5);
      y += 20;
    };
    evidenceRow('Project', ev.projectName || '—', 'Event ref', ev.ref || '—');
    evidenceRow('Site location', ev.location || '—', 'Event type', ev.type || '—');
    evidenceRow('Captured by', creatorName || ev.createdByName || '—', 'Evidence timestamp', fmtDate(ev.createdAt));
    evidenceRow('Instructed by', ev.instructedBy || '—', 'Status', ev.status);
    evidenceRow('Updated', fmtDate(ev.updatedAt), 'Reviewed', ev.reviewedByName ? `${ev.reviewedByName} · ${fmtDate(ev.reviewedAt)}` : 'Pending');
    y += 4;

    /* ---------- AI summary ---------- */
    ensure(120);
    const sumH = doc.font('Helvetica').fontSize(10.5).heightOfString(escPdf(ev.summary || '—'), { width: W - 2 * M - 26 }) + 40;
    doc.rect(M, y, W - 2 * M, sumH).fill(C.bg);
    doc.roundedRect(M, y, W - 2 * M, 24, 8).fill(C.surface);
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8)
      .text('AI-GENERATED SUMMARY · HUMAN-REVIEWED', M + 14, y + 8, { characterSpacing: 1 });
    doc.fillColor(C.text).font('Helvetica').fontSize(10.5)
      .text(escPdf(ev.summary || '—'), M + 14, y + 32, { width: W - 2 * M - 28, lineGap: 2.5 });
    y += sumH + 14;

    /* ---------- impacts ---------- */
    ensure(80);
    const impactBox = (x, title, impact, accent, noteColor) => {
      const h = 52;
      doc.roundedRect(x, y, rowW, h, 8).fill(C.bg);
      doc.rect(x, y, 5, h).fill(impact && impact.flag ? accent : C.border);
      doc.fillColor(C.muted).font('Helvetica-Bold').fontSize(7.5)
        .text(String(title).toUpperCase(), x + 16, y + 9, { characterSpacing: 0.7 });
      doc.fillColor(impact && impact.flag ? noteColor : C.faint).font('Helvetica-Bold').fontSize(9.5)
        .text(impact && impact.flag ? escPdf(impact.note || 'Flagged') : 'Not flagged', x + 16, y + 23, { width: rowW - 32 });
    };
    impactBox(M, 'Cost impact', ev.costImpact, C.orange, '#B34700');
    impactBox(M + rowW + 24, 'Time impact', ev.timeImpact, C.amber, '#7A5A00');
    y += 68;
    if (ev.notes) {
      ensure(40);
      label('Quick note', M, y);
      value(ev.notes, M + 118, y, W - M - 118 - M, 10.5);
      y += 22;
    }
    const audio = (ev.media || []).find((m) => m.kind === 'audio');
    if (audio) {
      ensure(30);
      doc.fillColor(C.green).font('Helvetica').fontSize(9)
        .text(`• Original voice note retained on the record${audio.size ? ` (${Math.round(audio.size / 1024)} KB)` : ''}`, M, y);
      y += 20;
    }

    /* ---------- photos ---------- */
    const photos = (ev.media || []).filter((m) => m.kind === 'image');
    if (photos.length) {
      y += 8;
      ensure(60);
      label(`Field photos (${photos.length})`, M, y);
      y += 16;
      for (let i = 0; i < photos.length; i += 2) {
        ensure(190);
        const boxW = (W - 2 * M - 16) / 2, boxH = 168;
        for (let j = 0; j < 2; j++) {
          const m = photos[i + j];
          if (!m) break;
          const px = M + j * (boxW + 16);
          doc.rect(px, y, boxW, boxH).fill(C.bg).strokeColor(C.border).lineWidth(1).stroke();
          const p = resolveMedia(m, mediaDirs);
          if (p) {
            try { doc.image(p, px + 6, y + 6, { fit: [boxW - 12, boxH - 12] }); }
            catch (e) { doc.fillColor(C.faint).font('Helvetica').fontSize(9).text('Photo unavailable', px + 10, y + 10); }
          } else {
            doc.fillColor(C.faint).font('Helvetica').fontSize(9).text('Photo unavailable', px + 10, y + 10);
          }
          doc.fillColor(C.muted).font('Helvetica').fontSize(7)
            .text(`Photo ${i + j + 1} · ${fmtDate(m.createdAt)}`, px + 6, y + boxH - 14, { width: boxW - 12 });
        }
        y += boxH + 12;
      }
    }

    /* ---------- audit trail ---------- */
    const audit = (ev.audit || []).slice().sort((a, b) => a.at.localeCompare(b.at));
    y += 8;
    ensure(50);
    label('Record timeline (audit trail)', M, y);
    y += 16;
    if (!audit.length) {
      value('No recorded activity', M, y, W - 2 * M, 10, C.faint);
      y += 18;
    }
    for (const a of audit) {
      ensure(26);
      doc.circle(M + 4, y + 4, 3.2).fill(C.orange);
      doc.fillColor(C.text).font('Helvetica-Bold').fontSize(10).text(escPdf(a.action || ''), M + 16, y, { width: W - M - 16 - 170 });
      doc.fillColor(C.muted).font('Helvetica').fontSize(8.5)
        .text(fmtDate(a.at), W - M - 170, y, { width: 170, align: 'right' });
      y += 13;
      doc.fillColor(C.muted).font('Helvetica').fontSize(9)
        .text(escPdf([a.detail, a.by && a.by.name].filter(Boolean).join(' · ')), M + 16, y, { width: W - M - 16 - 24 });
      y += 15;
    }

    drawFooter();
    doc.end();
  });
}

function resolveMedia(m, dirs) {
  for (const d of dirs) {
    const p = path.join(d, String(m.filename || ''));
    try { if (fs.existsSync(p)) return p; } catch (e) { /* ignore */ }
  }
  return null;
}

module.exports = { generateEventPdf };
