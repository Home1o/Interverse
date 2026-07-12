// Interverse — saved conversations (per-user, isolated)
const express = require("express");
const { client, dbReady } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// GET /api/conversations — list (light)
router.get("/", async (req, res) => {
  await dbReady;
  const r = await client.execute({
    sql: "SELECT id, title, mode, created_at, updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 200",
    args: [req.user.id],
  });
  res.json(r.rows);
});

// GET /api/conversations/:id — full
router.get("/:id", async (req, res) => {
  await dbReady;
  const r = await client.execute({
    sql: "SELECT * FROM conversations WHERE id=? AND user_id=?",
    args: [req.params.id, req.user.id],
  });
  if (!r.rows.length) return res.status(404).json({ error: "Not found" });
  const row = r.rows[0];
  res.json({ ...row, data: JSON.parse(row.data) });
});

// PUT /api/conversations/:id — upsert {title, mode, data}
router.put("/:id", async (req, res) => {
  await dbReady;
  const { title, mode, data } = req.body || {};
  if (!title || !mode || !data) return res.status(400).json({ error: "title, mode and data are required" });
  const json = JSON.stringify(data);
  if (json.length > 400000) return res.status(413).json({ error: "Conversation too large to save" });
  // ownership check: the id must be new or already belong to this user
  const owner = await client.execute({
    sql: "SELECT user_id FROM conversations WHERE id=?",
    args: [req.params.id],
  });
  if (owner.rows.length && Number(owner.rows[0].user_id) !== Number(req.user.id))
    return res.status(403).json({ error: "Not yours" });
  await client.execute({
    sql: `INSERT INTO conversations (id, user_id, title, mode, data)
          VALUES (?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET
            title=excluded.title, mode=excluded.mode, data=excluded.data,
            updated_at=datetime('now')
          WHERE conversations.user_id=?`,
    args: [req.params.id, req.user.id, String(title).slice(0, 120), mode, json, req.user.id],
  });
  res.json({ ok: true, id: req.params.id });
});

// DELETE /api/conversations/:id
router.delete("/:id", async (req, res) => {
  await dbReady;
  await client.execute({
    sql: "DELETE FROM conversations WHERE id=? AND user_id=?",
    args: [req.params.id, req.user.id],
  });
  res.json({ ok: true });
});

module.exports = router;
