// Interverse — OTP mailer. Uses SMTP when configured; logs to console in dev.
const nodemailer = require("nodemailer");

let transporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    secure: process.env.SMTP_PORT === "465",
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  console.log("[mail] SMTP configured:", process.env.SMTP_HOST);
} else {
  console.log("[mail] No SMTP config — OTP codes will be printed to the server console.");
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

  if (transporter) {
    await transporter.sendMail({
      from: process.env.FROM_EMAIL || process.env.SMTP_USER,
      to: email,
      subject,
      text,
      html,
    });
    console.log("[mail] OTP sent to", email);
  } else {
    console.log("==============================");
    console.log("  OTP FOR:", email);
    console.log("  CODE   :", code);
    console.log("==============================");
  }
}

module.exports = { sendOtp, mailConfigured: !!transporter };
