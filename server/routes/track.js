// Interverse — visit tracking.
//
// Answers two questions: how many times has someone been here, and where were
// they when they left. One row per visit, updated in place as they move, so a
// whole session costs a handful of row writes rather than one per event.
//
// Deliberately NOT authenticated. The most valuable drop-offs happen before
// anyone signs up — someone who reads the landing page and leaves is exactly
// the person you need to know about, and they have no token.
//
// What is stored: a random visitor id, which screens were reached, how long,
// mobile or desktop, and the referring site. What is NOT stored: IP addresses,
// full user agents, answer text, or anything typed into the app.
const express = require("express");
const { client } = require("../db");

const router = express.Router();

// sendBeacon posts as text/plain, so JSON parsing has to be permissive here.
router.use(express.text({ type: ["application/json", "text/plain"], limit: "8kb" }));

const SCREENS = new Set([
  "landing", "auth", "otp", "forgot", "reset",
  "setup", "batchprep", "session", "grading", "feedback", "saved", "profile",
]);

const MAX_PATH = 400;         // ~30 hops; longer means something is looping
const MAX_SECONDS = 6 * 3600; // a tab left open overnight isn't a six-hour visit

/* An unauthenticated write endpoint needs a floor on abuse. This is a simple
   in-memory cap per visitor per minute — enough to stop a script filling the
   table, cheap enough to not need Redis. Resets on deploy, which is fine. */
const seen = new Map();
function tooMany(vid) {
  const now = Date.now();
  const rec = seen.get(vid);
  if (!rec || now - rec.t > 60000) { seen.set(vid, { t: now, n: 1 }); return false; }
  rec.n++;
  if (seen.size > 5000) seen.clear();   // crude bound on memory
  return rec.n > 60;
}

const clean = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001F]/g, "").slice(0, max);

router.post("/", async (req, res) => {
  // Always 204 quickly: this must never slow down or break the page, and a
  // beacon fired during unload has nobody left to read an error.
  res.status(204).end();

  let b = {};
  try { b = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {}; }
  catch (e) { return; }

  const id = clean(b.id, 40);
  const visitor = clean(b.visitor, 40);
  if (!id || !visitor || tooMany(visitor)) return;

  const screen = SCREENS.has(b.screen) ? b.screen : "landing";
  const path = clean(b.path, MAX_PATH);
  const device = b.device === "mobile" ? "mobile" : "desktop";
  const referrer = clean(b.referrer, 80);
  const seconds = Math.max(0, Math.min(MAX_SECONDS, parseInt(b.seconds, 10) || 0));
  const screens = Math.max(1, Math.min(200, parseInt(b.screens, 10) || 1));
  const userId = Number.isInteger(b.userId) && b.userId > 0 ? b.userId : null;

  try {
    // First write for this visit creates the row; every later one updates it.
    // user_id uses COALESCE so signing in mid-visit fills it without wiping it
    // on subsequent anonymous-looking beacons.
    await client.execute({
      sql: `INSERT INTO visits (id, visitor_id, user_id, device, referrer, first_screen, last_screen, path, screens, seconds)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              user_id    = COALESCE(excluded.user_id, visits.user_id),
              last_screen= excluded.last_screen,
              path       = excluded.path,
              screens    = MAX(visits.screens, excluded.screens),
              seconds    = MAX(visits.seconds, excluded.seconds),
              last_seen  = datetime('now')`,
      args: [id, visitor, userId, device, referrer, screen, screen, path, screens, seconds],
    });
  } catch (e) {
    console.warn("[track]", e.message);
  }
});

module.exports = router;
