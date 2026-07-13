// Interverse — OTP mailer with three modes (auto-detected):
//   1. BREVO_API_KEY set  → Brevo HTTP API over HTTPS (works on Render free tier,
//                           which BLOCKS outbound SMTP ports entirely)
//   2. SMTP_* vars set    → classic SMTP via nodemailer (for hosts that allow it)
//   3. neither            → console fallback: codes print to server logs
const nodemailer = require("nodemailer");

const BREVO_KEY = process.env.BREVO_API_KEY || null;
const FROM = process.env.FROM_EMAIL || process.env.SMTP_USER || null;

let transporter = null;
if (!BREVO_KEY && process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
}

if (BREVO_KEY) {
  console.log("[mail] Brevo HTTP API mode (HTTPS — safe on Render free tier)");
  if (!FROM) console.error("[mail] WARNING: set FROM_EMAIL to a sender verified in Brevo");
} else if (transporter) {
  console.log("[mail] SMTP mode:", process.env.SMTP_HOST, "— NOTE: Render free tier blocks SMTP; prefer BREVO_API_KEY there");
} else {
  console.log("[mail] No mail config — OTP codes will be printed to the server console.");
}

async function sendViaBrevoApi(to, subject, text, html) {
  const r = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_KEY, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      sender: { email: FROM, name: "Interverse" },
      to: [{ email: to }],
      subject: subject,
      textContent: text,
      htmlContent: html,
    }),
  });
  if (!r.ok) {
    const d = await r.json().catch(() => ({}));
    throw new Error("Brevo API " + r.status + ": " + (d.message || JSON.stringify(d).slice(0, 140)));
  }
}

// on-demand connectivity check (used by /api/health)
async function checkMail() {
  if (BREVO_KEY) {
    try {
      const r = await fetch("https://api.brevo.com/v3/account", { headers: { "api-key": BREVO_KEY } });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        return { mail: "fail", mode: "brevo_api", error: "Brevo " + r.status + ": " + (d.message || "key rejected") };
      }
      return { mail: "ok", mode: "brevo_api", from: FROM };
    } catch (e) {
      return { mail: "fail", mode: "brevo_api", error: e.message };
    }
  }
  if (transporter) {
    try { await transporter.verify(); return { mail: "ok", mode: "smtp", host: process.env.SMTP_HOST }; }
    catch (e) { return { mail: "fail", mode: "smtp", error: e.message + " (Render free tier blocks SMTP — use BREVO_API_KEY instead)" }; }
  }
  return { mail: "not_configured", hint: "Set BREVO_API_KEY (recommended on Render) or SMTP_* vars" };
}

async function sendOtp(email, code) {
  const subject = "Your Interverse verification code";
  const text = `Your Interverse verification code is: ${code}\n\nIt expires in 10 minutes. If you didn't request this, ignore this email.`;
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
      <h2 style="margin:0 0 4px;color:#1F2A37;">Interverse</h2>
      <p style="color:#66707D;margin:0 0 20px;">Voice interview practice</p>
      <p style="color:#1F2A37;">Your verification code:</p>
      <div style="font-size:32px;letter-spacing:8px;font-weight:bold;color:#136F63;padding:14px 0;">${code}</div>
      <p style="color:#66707D;font-size:13px;">This code expires in 10 minutes. If you didn't request it, you can safely ignore this email.</p>
    </div>`;

  if (BREVO_KEY) {
    await sendViaBrevoApi(email, subject, text, html);
    console.log("[mail] OTP sent to", email, "(Brevo API)");
  } else if (transporter) {
    await transporter.sendMail({ from: FROM, to: email, subject, text, html });
    console.log("[mail] OTP sent to", email, "(SMTP)");
  } else {
    console.log("==============================");
    console.log("  OTP FOR:", email);
    console.log("  CODE   :", code);
    console.log("==============================");
  }
}

module.exports = { sendOtp, checkMail, mailConfigured: !!(BREVO_KEY || transporter) };
