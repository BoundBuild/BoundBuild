/**
 * Branded HTML email body for event dispatch (the "clean handoff to the QS").
 * Inline CSS only — renders in every mail client.
 */

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-NZ', { dateStyle: 'medium', timeStyle: 'short' });
}

function impactRow(label, impact, accent) {
  const color = impact && impact.flag ? accent : '#9AA3AD';
  const val = impact && impact.flag ? (impact.note || 'Flagged') : 'Not flagged';
  return `<tr><td style="padding:8px 16px;border-bottom:1px solid #23282E;color:#9AA3AD;font-size:13px;">${label}</td>
  <td style="padding:8px 16px;border-bottom:1px solid #23282E;color:${color};font-weight:600;font-size:13px;">${esc(val)}</td></tr>`;
}

function outboxEmailHtml({ event, project, recipientLink, fromName }) {
  const bg = '#0A0C0E', surface = '#131619', border = '#23282E';
  const text = '#F5F7FA', muted = '#9AA3AD', orange = '#FF6A00';
  const typeColor = event.type === 'Delay' ? '#FFB020' : event.type === 'Variation' ? '#FF6A00' : '#4CC38A';

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:${bg};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${bg};padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:${surface};border:1px solid ${border};border-radius:14px;overflow:hidden;">
  <tr><td style="background:${surface};padding:20px 24px;border-bottom:1px solid ${border};">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td><span style="font-size:20px;font-weight:800;color:${text};letter-spacing:0.5px;"><span style="background:${orange};color:#0A0C0E;padding:2px 8px;border-radius:6px;font-weight:900;">B</span>&nbsp;BOUNDBUILD</span>
      <div style="color:${muted};font-size:11px;letter-spacing:2px;margin-top:4px;">CAPTURE · DOCUMENT · GET PAID</div></td>
      <td align="right"><span style="background:${typeColor}22;color:${typeColor};border:1px solid ${typeColor}55;font-size:11px;font-weight:700;padding:4px 10px;border-radius:20px;letter-spacing:1px;">${esc(event.type.toUpperCase())}</span></td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:24px;">
    <div style="color:${muted};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;">Commercial event · ${esc(project.name)}</div>
    <h1 style="margin:8px 0 4px;font-size:22px;color:${text};line-height:1.3;">${esc(event.title)}</h1>
    <div style="color:${muted};font-size:12px;margin-bottom:20px;">Captured ${fmtDate(event.createdAt)} by ${esc(event.createdByName || 'site team')} · Event #${esc(event.ref)}</div>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:20px;">
      <tr><td style="padding:14px 16px;border-bottom:1px solid ${border};color:${muted};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;">Summary</td></tr>
      <tr><td style="padding:14px 16px;color:${text};font-size:14px;line-height:1.6;">${esc(event.summary || '—')}</td></tr>
    </table>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:${bg};border:1px solid ${border};border-radius:10px;margin-bottom:20px;">
      <tr><td style="padding:14px 16px;border-bottom:1px solid ${border};color:${muted};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;">Details</td></tr>
      <tr><td style="padding:8px 16px;border-bottom:1px solid ${border};color:#9AA3AD;font-size:13px;">Location / area</td><td style="padding:8px 16px;border-bottom:1px solid ${border};color:${text};font-size:13px;">${esc(event.location || '—')}</td></tr>
      ${impactRow('Instructed by', event.instructedBy ? { flag: true, note: event.instructedBy } : null, text)}
      ${impactRow('Time impact', event.timeImpact, '#FFB020')}
      ${impactRow('Cost impact', event.costImpact, orange)}
      <tr><td style="padding:8px 16px;border-bottom:1px solid ${border};color:#9AA3AD;font-size:13px;">Status</td><td style="padding:8px 16px;border-bottom:1px solid ${border};color:${text};font-size:13px;">${esc(event.status)} · Reviewed by ${esc(event.reviewedByName || 'pending')}</td></tr>
    </table>

    ${event.mediaCount ? `<div style="color:${muted};font-size:12px;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:10px;">${event.mediaCount} photo(s) attached on the site app</div>` : ''}

    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td align="center" style="padding:4px 0 20px;">
        <a href="${recipientLink}" style="display:inline-block;background:${orange};color:#0A0C0E;font-weight:800;font-size:14px;text-decoration:none;padding:14px 28px;border-radius:10px;letter-spacing:0.5px;">OPEN FULL RECORD WITH PHOTOS →</a>
      </td>
    </tr></table>

    <div style="color:#6B7480;font-size:11px;line-height:1.5;border-top:1px solid ${border};padding-top:14px;">
      This is an automated commercial event record from BoundBuild. Review the record, reply to this email, or contact the sender ${esc(fromName ? '(' + fromName + ')' : '')} to discuss.<br/>
      Draft records are captured in the field and may contain conversational wording — verify before relying on them commercially.
    </div>
  </td></tr>
</table>
</td></tr></table>
</body></html>`;
}

module.exports = { outboxEmailHtml };
