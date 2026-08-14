/**
 * BoundBuild — branded email signature block (shared by all outgoing emails).
 * Includes logo, tagline, website, and the sender line.
 */

function emailSignatureHtml({ fromName = '' } = {}) {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;border-top:1px solid #23282E;padding-top:16px;">
    <tr>
      <td style="vertical-align:top;">
        <table role="presentation" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#FF6A00;border-radius:6px;width:34px;height:34px;text-align:center;vertical-align:middle;font-weight:900;font-size:18px;color:#0A0C0E;">B</td>
            <td style="padding-left:10px;vertical-align:middle;">
              <div style="font-weight:900;letter-spacing:1.5px;color:#F5F7FA;font-size:14px;">BOUNDBUILD</div>
              <div style="color:#FF6A00;font-size:9px;letter-spacing:2px;font-weight:700;">CAPTURE · DOCUMENT · GET PAID</div>
            </td>
          </tr>
        </table>
        <div style="color:#9AA3AD;font-size:12px;margin-top:8px;line-height:1.6;">
          <div><b style="color:#F5F7FA;">BoundBuild Team</b></div>
          <div>BoundBuild — construction commercial event capture</div>
          <div><a href="https://boundbuild.co.nz" style="color:#FF8A33;text-decoration:none;">boundbuild.co.nz</a></div>
          <div><a href="tel:0220680824" style="color:#FF8A33;text-decoration:none;">022 068 0824</a> · <a href="mailto:pilot@boundbuild.co.nz" style="color:#FF8A33;text-decoration:none;">pilot@boundbuild.co.nz</a></div>
        </div>
      </td>
    </tr>
  </table>`;
}

function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { emailSignatureHtml };
