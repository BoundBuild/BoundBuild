/**
 * BoundBuild — pilot enquiry endpoint (public).
 * The marketing website (boundbuild.co.nz) posts pilot requests here.
 * We store the enquiry in the database AND email the founder via Postmark.
 * Spam protection: hidden honeypot field (bots fill it, humans don't).
 */
const { load, save, now } = require('./store');
const { sendEmail } = require('./mailer');
const { emailSignatureHtml } = require('./signature');

module.exports = function registerPilotRoutes(app) {
  // CORS preflight for the website (boundbuild.co.nz → app.boundbuild.co.nz)
  app.options('/api/pilot-enquiry', (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.sendStatus(204);
  });

  app.post('/api/pilot-enquiry', async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    const { name, company, email, website } = req.body || {};

    // Honeypot: if the hidden 'website' field was filled, it's a bot — pretend success.
    if (website && String(website).trim()) return res.json({ ok: true });

    if (!name || !company || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email || ''))) {
      return res.status(400).json({ error: 'Name, company and a valid email are required' });
    }

    // Store the enquiry (survives on the persistent disk)
    const db = load();
    db.pilotEnquiries = db.pilotEnquiries || [];
    db.pilotEnquiries.push({
      id: 'enq_' + Date.now(),
      name: String(name).trim(),
      company: String(company).trim(),
      email: String(email).trim(),
      at: now(),
    });
    save();

    // Email the founder via Postmark (SMTP already configured)
    const to = process.env.PILOT_ENQUIRY_TO || 'pilot@boundbuild.co.nz';
    const subject = `[BoundBuild] New pilot enquiry — ${String(company).trim()}`;
    const html = `<!DOCTYPE html><html><body style="margin:0;background:#0A0C0E;font-family:Arial,Helvetica,sans-serif;padding:24px;">
<div style="max-width:560px;margin:0 auto;background:#131619;border:1px solid #23282E;border-radius:14px;overflow:hidden;">
  <div style="background:#0A0C0E;padding:18px 22px;border-bottom:1px solid #23282E;">
    <span style="background:#FF6A00;color:#0A0C0E;font-weight:900;padding:2px 8px;border-radius:6px;">B</span>
    <span style="color:#fff;font-weight:800;letter-spacing:1.5px;margin-left:8px;">BOUNDBUILD</span>
    <span style="color:#FF6A00;font-size:10px;letter-spacing:2px;display:block;margin-top:4px;">CAPTURE · DOCUMENT · GET PAID</span>
  </div>
  <div style="padding:22px;">
    <div style="color:#9AA3AD;font-size:11px;letter-spacing:2px;text-transform:uppercase;font-weight:700;">New pilot request</div>
    <h2 style="color:#F5F7FA;margin:10px 0 4px;">${String(company).trim()}</h2>
    <table style="width:100%;margin-top:14px;border-collapse:collapse;">
      <tr><td style="padding:10px 0;border-bottom:1px solid #23282E;color:#9AA3AD;font-size:13px;width:110px;">Name</td><td style="padding:10px 0;border-bottom:1px solid #23282E;color:#F5F7FA;font-size:13px;font-weight:700;">${String(name).trim()}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #23282E;color:#9AA3AD;font-size:13px;">Company</td><td style="padding:10px 0;border-bottom:1px solid #23282E;color:#F5F7FA;font-size:13px;font-weight:700;">${String(company).trim()}</td></tr>
      <tr><td style="padding:10px 0;color:#9AA3AD;font-size:13px;">Email</td><td style="padding:10px 0;color:#F5F7FA;font-size:13px;font-weight:700;"><a href="mailto:${String(email).trim()}" style="color:#FF8A33;">${String(email).trim()}</a></td></tr>
    </table>
    <a href="mailto:${String(email).trim()}?subject=BoundBuild%20pilot%20-%20${encodeURIComponent(String(company).trim())}" style="display:inline-block;margin-top:20px;background:#FF6A00;color:#0A0C0E;font-weight:800;font-size:14px;text-decoration:none;padding:13px 24px;border-radius:10px;">Reply to this enquiry →</a>
    <div style="color:#6B7480;font-size:11px;margin-top:18px;border-top:1px solid #23282E;padding-top:12px;">Sent automatically from boundbuild.co.nz · stored in the BoundBuild ledger</div>
    ${emailSignatureHtml({})}
  </div>
</div></body></html>`;

    const result = await sendEmail({ to, subject, html });
    console.log(`Pilot enquiry from ${email} → ${to} (${result.status})`);
    res.json({ ok: true, status: result.status });
  });
};
