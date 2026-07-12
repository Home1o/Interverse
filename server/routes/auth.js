// Interverse — auth: register → email OTP → verify → JWT. Login with password.
const express = require("express");
const bcrypt = require("bcryptjs");
const { client, dbReady } = require("../db");
const { sendOtp } = require("../mailer");
const { sign } = require("../middleware/auth");

const router = express.Router();
const DEV = process.env.NODE_ENV !== "production";

const emailOk = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e || "");

async function issueOtp(email) {
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await client.execute({
    sql: "INSERT INTO otps (email, code, expires_at) VALUES (?, ?, datetime('now','+10 minutes'))",
    args: [email, code],
  });
  await sendOtp(email, code);
  return code;
}

// POST /api/auth/register  {email, name, password}
router.post("/register", async (req, res) => {
  try {
    await dbReady;
    const email = String(req.body.email || "").trim().toLowerCase();
    const name = String(req.body.name || "").trim();
    const password = String(req.body.password || "");
    if (!emailOk(email)) return res.status(400).json({ error: "Enter a valid email address" });
    if (name.length < 2) return res.status(400).json({ error: "Enter your name" });
    if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

    const existing = await client.execute({ sql: "SELECT * FROM users WHERE email=?", args: [email] });
    const hash = bcrypt.hashSync(password, 10);

    if (existing.rows.length) {
      const u = existing.rows[0];
      if (Number(u.verified) === 1)
        return res.status(409).json({ error: "This email is already registered — sign in instead", code: "EMAIL_EXISTS" });
      // unverified re-register: refresh details + resend code
      await client.execute({
        sql: "UPDATE users SET name=?, password_hash=? WHERE email=?",
        args: [name, hash, email],
      });
    } else {
      await client.execute({
        sql: "INSERT INTO users (email, name, password_hash, verified) VALUES (?,?,?,0)",
        args: [email, name, hash],
      });
    }
    const code = await issueOtp(email);
    res.json({ ok: true, needVerify: true, message: "Verification code sent to " + email, ...(DEV ? { devOtp: code } : {}) });
  } catch (e) {
    console.error("[auth/register]", e.message);
    res.status(500).json({ error: "Registration failed — try again" });
  }
});

// POST /api/auth/verify-otp  {email, code}
router.post("/verify-otp", async (req, res) => {
  try {
    await dbReady;
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();
    const r = await client.execute({
      sql: "SELECT * FROM otps WHERE email=? AND code=? AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
      args: [email, code],
    });
    if (!r.rows.length) return res.status(400).json({ error: "Invalid or expired code" });

    await client.execute({ sql: "UPDATE users SET verified=1 WHERE email=?", args: [email] });
    await client.execute({ sql: "DELETE FROM otps WHERE email=?", args: [email] });

    const ur = await client.execute({ sql: "SELECT * FROM users WHERE email=?", args: [email] });
    const u = ur.rows[0];
    const user = { id: Number(u.id), email: u.email, name: u.name };
    res.json({ ok: true, token: sign(user), user });
  } catch (e) {
    console.error("[auth/verify]", e.message);
    res.status(500).json({ error: "Verification failed — try again" });
  }
});

// POST /api/auth/resend-otp  {email}
router.post("/resend-otp", async (req, res) => {
  try {
    await dbReady;
    const email = String(req.body.email || "").trim().toLowerCase();
    const ur = await client.execute({ sql: "SELECT * FROM users WHERE email=?", args: [email] });
    if (!ur.rows.length) return res.status(404).json({ error: "No account with that email" });
    const code = await issueOtp(email);
    res.json({ ok: true, message: "New code sent", ...(DEV ? { devOtp: code } : {}) });
  } catch (e) {
    console.error("[auth/resend]", e.message);
    res.status(500).json({ error: "Couldn't send code — try again" });
  }
});

// POST /api/auth/login  {email, password}
router.post("/login", async (req, res) => {
  try {
    await dbReady;
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const ur = await client.execute({ sql: "SELECT * FROM users WHERE email=?", args: [email] });
    if (!ur.rows.length) return res.status(401).json({ error: "Wrong email or password" });
    const u = ur.rows[0];
    if (!bcrypt.compareSync(password, u.password_hash))
      return res.status(401).json({ error: "Wrong email or password" });
    if (Number(u.verified) !== 1) {
      const code = await issueOtp(email);
      return res.json({ ok: true, needVerify: true, message: "Email not verified — code sent", ...(DEV ? { devOtp: code } : {}) });
    }
    const user = { id: Number(u.id), email: u.email, name: u.name };
    res.json({ ok: true, token: sign(user), user });
  } catch (e) {
    console.error("[auth/login]", e.message);
    res.status(500).json({ error: "Sign in failed — try again" });
  }
});

// POST /api/auth/forgot-password  {email} — sends a reset OTP
router.post("/forgot-password", async (req, res) => {
  try {
    await dbReady;
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!emailOk(email)) return res.status(400).json({ error: "Enter a valid email address" });
    const ur = await client.execute({ sql: "SELECT id FROM users WHERE email=?", args: [email] });
    if (!ur.rows.length)
      return res.status(404).json({ error: "No account with that email", code: "NO_ACCOUNT" });
    const code = await issueOtp(email);
    res.json({ ok: true, message: "Password reset code sent to " + email, ...(DEV ? { devOtp: code } : {}) });
  } catch (e) {
    console.error("[auth/forgot]", e.message);
    res.status(500).json({ error: "Couldn't send reset code — try again" });
  }
});

// POST /api/auth/reset-password  {email, code, newPassword} — verifies OTP, sets password, signs in
router.post("/reset-password", async (req, res) => {
  try {
    await dbReady;
    const email = String(req.body.email || "").trim().toLowerCase();
    const code = String(req.body.code || "").trim();
    const newPassword = String(req.body.newPassword || "");
    if (newPassword.length < 8)
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    const r = await client.execute({
      sql: "SELECT * FROM otps WHERE email=? AND code=? AND expires_at > datetime('now') ORDER BY id DESC LIMIT 1",
      args: [email, code],
    });
    if (!r.rows.length) return res.status(400).json({ error: "Invalid or expired code" });

    const hash = bcrypt.hashSync(newPassword, 10);
    // proving OTP ownership of the inbox also verifies the email
    await client.execute({ sql: "UPDATE users SET password_hash=?, verified=1 WHERE email=?", args: [hash, email] });
    await client.execute({ sql: "DELETE FROM otps WHERE email=?", args: [email] });

    const ur = await client.execute({ sql: "SELECT * FROM users WHERE email=?", args: [email] });
    if (!ur.rows.length) return res.status(404).json({ error: "No account with that email" });
    const u = ur.rows[0];
    const user = { id: Number(u.id), email: u.email, name: u.name };
    res.json({ ok: true, token: sign(user), user, message: "Password reset — you're signed in" });
  } catch (e) {
    console.error("[auth/reset]", e.message);
    res.status(500).json({ error: "Reset failed — try again" });
  }
});

module.exports = router;
