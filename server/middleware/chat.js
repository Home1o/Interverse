// Interverse — server-side proxy to the Anthropic API.
// The API key lives only in the ANTHROPIC_API_KEY env var, never in the browser.
const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.post("/", async (req, res) => {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key)
    return res.status(500).json({ error: "Server is missing ANTHROPIC_API_KEY — set it in your environment." });

  const { system, messages, max_tokens } = req.body || {};
  if (!Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: "messages array required" });

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: Math.min(Number(max_tokens) || 1000, 2000),
        system: String(system || ""),
        messages: messages.map((m) => ({
          role: m.role === "assistant" ? "assistant" : "user",
          content: String(m.content || "").slice(0, 20000),
        })),
      }),
    });
    const data = await r.json();
    if (!r.ok) {
      console.error("[chat] upstream error", r.status, JSON.stringify(data).slice(0, 300));
      return res.status(502).json({ error: "AI request failed — check the server's API key and credits." });
    }
    const text = (data.content || [])
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    res.json({ text });
  } catch (e) {
    console.error("[chat]", e.message);
    res.status(502).json({ error: "Couldn't reach the AI service" });
  }
});

module.exports = router;
