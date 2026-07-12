// Interverse — server-side AI proxy. Supports three providers, auto-detected
// by whichever API key is set (checked in this order):
//   1. GROQ_API_KEY      — free at console.groq.com (no card needed)
//   2. GEMINI_API_KEY    — free at aistudio.google.com (no card needed)
//   3. ANTHROPIC_API_KEY — paid, console.anthropic.com
// Keys live only in env vars, never in the browser.
const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

function pickProvider() {
  if (process.env.GROQ_API_KEY)
    return {
      name: "groq",
      url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      model: process.env.AI_MODEL || "llama-3.3-70b-versatile",
      style: "openai",
    };
  if (process.env.GEMINI_API_KEY)
    return {
      name: "gemini",
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: process.env.GEMINI_API_KEY,
      model: process.env.AI_MODEL || "gemini-2.0-flash",
      style: "openai",
    };
  if (process.env.ANTHROPIC_API_KEY)
    return {
      name: "anthropic",
      url: "https://api.anthropic.com/v1/messages",
      key: process.env.ANTHROPIC_API_KEY,
      model: process.env.AI_MODEL || "claude-sonnet-4-5",
      style: "anthropic",
    };
  return null;
}

router.post("/", async (req, res) => {
  const p = pickProvider();
  if (!p)
    return res.status(500).json({
      error: "No AI key configured. Set GROQ_API_KEY (free, console.groq.com) or GEMINI_API_KEY (free, aistudio.google.com) in the environment.",
    });

  const { system, messages, max_tokens } = req.body || {};
  if (!Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: "messages array required" });

  const cleanMsgs = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 20000),
  }));
  const maxTok = Math.min(Number(max_tokens) || 1000, 2000);

  let url, headers, body;
  if (p.style === "anthropic") {
    url = p.url;
    headers = {
      "Content-Type": "application/json",
      "x-api-key": p.key,
      "anthropic-version": "2023-06-01",
    };
    body = { model: p.model, max_tokens: maxTok, temperature: 0.5, system: String(system || ""), messages: cleanMsgs };
  } else {
    // OpenAI-compatible (Groq, Gemini): system goes in as the first message
    url = p.url;
    headers = {
      "Content-Type": "application/json",
      "Authorization": "Bearer " + p.key,
    };
    body = {
      model: p.model,
      max_tokens: maxTok,
      temperature: 0.5,
      // both Groq and Gemini's OpenAI-compat endpoint support forced JSON output
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: String(system || "") }, ...cleanMsgs],
    };
  }

  try {
    let r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    let data = await r.json().catch(() => ({}));
    // some models reject response_format — retry once without it
    if (!r.ok && body.response_format) {
      const msg = JSON.stringify(data);
      if (/response_format|json_object|json mode/i.test(msg)) {
        delete body.response_format;
        r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
        data = await r.json().catch(() => ({}));
      }
    }
    if (!r.ok) {
      const detail =
        (data.error && (data.error.message || data.error.type)) ||
        (typeof data.error === "string" ? data.error : "") ||
        "unknown error";
      console.error("[chat]", p.name, "upstream error", r.status, String(detail).slice(0, 300));
      return res.status(502).json({ error: "AI request failed (" + p.name + "): " + String(detail).slice(0, 160) });
    }
    let text = "";
    if (p.style === "anthropic") {
      text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    } else {
      text = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || "";
    }
    if (!text) return res.status(502).json({ error: "AI returned an empty reply — try again" });
    res.json({ text });
  } catch (e) {
    console.error("[chat]", p.name, e.message);
    res.status(502).json({ error: "Couldn't reach the AI service (" + p.name + ")" });
  }
});

module.exports = router;
