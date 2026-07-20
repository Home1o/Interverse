// Interverse — user profile: who they are, what they're preparing for, resume text.
const express = require("express");
const { client, dbReady } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/profile
router.get("/", async (req, res) => {
  try {
    await dbReady;
    const r = await client.execute({ sql: "SELECT profile FROM users WHERE id=?", args: [req.user.id] });
    let p = {};
    if (r.rows.length && r.rows[0].profile) { try { p = JSON.parse(r.rows[0].profile); } catch (e) {} }
    res.json(p);
  } catch (e) {
    console.error("[profile/get]", e.message);
    res.json({});
  }
});

// PUT /api/profile  {category, level, target, about, resume}
router.put("/", async (req, res) => {
  try {
    await dbReady;
    const b = req.body || {};
    const profile = {
      category: String(b.category || "").slice(0, 40),
      level: String(b.level || "").slice(0, 120),
      target: String(b.target || "").slice(0, 200),
      about: String(b.about || "").slice(0, 2000),
      resume: String(b.resume || "").slice(0, 60000), // extracted resume text
      updated_at: new Date().toISOString(),
    };
    await client.execute({
      sql: "UPDATE users SET profile=? WHERE id=?",
      args: [JSON.stringify(profile), req.user.id],
    });
    res.json({ ok: true, profile });
  } catch (e) {
    console.error("[profile/put]", e.message);
    res.status(500).json({ error: "Couldn't save profile — try again" });
  }
});

module.exports = router;
