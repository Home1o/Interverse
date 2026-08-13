// Interverse — product feedback from the sidebar.
const express = require("express");
const { client, dbReady } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// POST /api/feedback  {rating, message, page}
router.post("/", async (req, res) => {
  try {
    await dbReady;
    const b = req.body || {};
    const message = String(b.message || "").trim().slice(0, 4000);
    if (message.length < 3) return res.status(400).json({ error: "Please write a little more." });

    const rating = ["good", "ok", "bad"].includes(b.rating) ? b.rating : null;

    await client.execute({
      sql: "INSERT INTO feedback (user_id, rating, message, page) VALUES (?,?,?,?)",
      args: [req.user.id, rating, message, String(b.page || "").slice(0, 40)],
    });
    res.json({ ok: true });
  } catch (e) {
    console.error("[feedback/post]", e.message);
    res.status(500).json({ error: "Couldn't send that — try again in a moment." });
  }
});

module.exports = router;
