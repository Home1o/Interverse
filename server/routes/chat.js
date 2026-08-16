// Interverse — server-side AI proxy. Auto-detects provider by which key is set:
//   1. GROQ_API_KEY (free)  2. GEMINI_API_KEY (free)  3. ANTHROPIC_API_KEY (paid)
//
// Two things this route protects against:
//   • Rate limits. Groq's free tier gives llama-3.3-70b-versatile 12,000 tokens
//     per MINUTE, counting input + output, per organization. A long deck pasted
//     into the system prompt blows that in a single call. Every request is
//     budgeted down before it leaves here.
//   • Images. The text models can't see them, so a request carrying images is
//     routed to a vision model automatically.
const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Rough but stable: ~3.6 characters per token for English prose.
const CHARS_PER_TOKEN = 3.6;
// Leave headroom inside the 12k TPM window — analytics scoring fires alongside
// every conversational turn, so a turn really costs two requests.
const TOKEN_BUDGET = Number(process.env.AI_TOKEN_BUDGET || 6500);
const MAX_IMAGES = 4;

function estTokens(s) { return Math.ceil(String(s || "").length / CHARS_PER_TOKEN); }

// Trim from the middle: the opening of a document sets it up, the end usually
// carries the conclusion. Losing the middle beats losing either edge.
function squeeze(str, maxChars) {
  if (str.length <= maxChars) return str;
  const marker = "\n\n[\u2026 middle trimmed to fit the model's rate limit \u2026]\n\n";
  const keep = maxChars - marker.length;
  const head = Math.floor(keep * 0.7);
  return str.slice(0, head) + marker + str.slice(-(keep - head));
}

function pickProvider(hasImages) {
  if (process.env.GROQ_API_KEY)
    return { name: "groq", url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      model: hasImages
        ? (process.env.AI_VISION_MODEL || "qwen/qwen3.6-27b")
        : (process.env.AI_MODEL || "llama-3.3-70b-versatile"),
      style: "openai" };
  if (process.env.GEMINI_API_KEY)
    return { name: "gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      key: process.env.GEMINI_API_KEY, model: process.env.AI_MODEL || "gemini-2.0-flash", style: "openai" };
  if (process.env.ANTHROPIC_API_KEY)
    return { name: "anthropic", url: "https://api.anthropic.com/v1/messages",
      key: process.env.ANTHROPIC_API_KEY, model: process.env.AI_MODEL || "claude-sonnet-4-5", style: "anthropic" };
  return null;
}

// Accepts "data:image/png;base64,AAAA..." and returns the parts both API
// shapes need, or null if it isn't a usable image.
function parseDataUrl(u) {
  const m = /^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(u || "").trim());
  if (!m) return null;
  return { url: String(u).trim(), media_type: m[1] === "image/jpg" ? "image/jpeg" : m[1], data: m[2] };
}

router.post("/", async (req, res) => {
  const { system, messages, max_tokens } = req.body || {};

  const images = (Array.isArray(req.body && req.body.images) ? req.body.images : [])
    .map(parseDataUrl).filter(Boolean).slice(0, MAX_IMAGES);

  const p = pickProvider(images.length > 0);
  if (!p)
    return res.status(500).json({ error: "No AI key configured. Set GROQ_API_KEY (free, console.groq.com) or GEMINI_API_KEY (free, aistudio.google.com)." });

  if (!Array.isArray(messages) || !messages.length)
    return res.status(400).json({ error: "messages array required" });

  let cleanMsgs = messages.map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 20000),
  }));
  const maxTok = Math.min(Number(max_tokens) || 1000, 2000);

  /* ---------- fit the request inside the token budget ---------- */
  // Each image is charged as tokens too; budget for them before the text.
  const imageCost = images.length * 900;
  let allowedChars = Math.max(2000, (TOKEN_BUDGET - maxTok - imageCost) * CHARS_PER_TOKEN);
  let sys = String(system || "");
  const sysFloor = Math.floor(allowedChars * 0.65); // the system prompt is the rules; keep most of it

  // 1. Drop the oldest turns first — recent context matters more than old.
  let msgChars = () => cleanMsgs.reduce((n, m) => n + m.content.length, 0);
  let dropped = 0;
  while (cleanMsgs.length > 1 && sys.length + msgChars() > allowedChars) {
    cleanMsgs.shift();
    dropped++;
  }
  // 2. Still over? Trim the system prompt (its bulk is the pasted material).
  if (sys.length + msgChars() > allowedChars) {
    sys = squeeze(sys, Math.max(sysFloor, allowedChars - msgChars()));
  }
  // 3. Last resort: the single remaining message is itself enormous.
  if (sys.length + msgChars() > allowedChars && cleanMsgs.length === 1) {
    cleanMsgs[0].content = squeeze(cleanMsgs[0].content, Math.max(1200, allowedChars - sys.length));
  }
  if (dropped) console.log("[chat] trimmed", dropped, "old turn(s) to fit the token budget");

  /* ---------- attach images to the FIRST user message ---------- */
  let url, headers, body;
  if (p.style === "anthropic") {
    const msgs = cleanMsgs.map((m) => ({ role: m.role, content: m.content }));
    if (images.length) {
      const i = msgs.findIndex((m) => m.role === "user");
      if (i >= 0) msgs[i] = { role: "user", content: [
        ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.media_type, data: im.data } })),
        { type: "text", text: msgs[i].content },
      ] };
    }
    url = p.url;
    headers = { "Content-Type": "application/json", "x-api-key": p.key, "anthropic-version": "2023-06-01" };
    body = { model: p.model, max_tokens: maxTok, temperature: 0.5, system: sys, messages: msgs };
  } else {
    const msgs = cleanMsgs.map((m) => ({ role: m.role, content: m.content }));
    if (images.length) {
      const i = msgs.findIndex((m) => m.role === "user");
      if (i >= 0) msgs[i] = { role: "user", content: [
        { type: "text", text: msgs[i].content },
        ...images.map((im) => ({ type: "image_url", image_url: { url: im.url } })),
      ] };
    }
    url = p.url;
    headers = { "Content-Type": "application/json", "Authorization": "Bearer " + p.key };
    body = {
      model: p.model, max_tokens: maxTok, temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, ...msgs],
    };
  }

  try {
    let r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    let data = await r.json().catch(() => ({}));

    // If strict JSON mode failed for ANY reason, retry once without it.
    // Groq returns the model's raw attempt in error.failed_generation — keep it as a fallback.
    let salvaged = null;
    if (!r.ok && body.response_format) {
      salvaged = (data && data.error && data.error.failed_generation) || null;
      delete body.response_format;
      r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      data = await r.json().catch(() => ({}));
    }
    if (!r.ok && salvaged) {
      console.warn("[chat]", p.name, "using salvaged failed_generation output");
      return res.json({ text: String(salvaged) });
    }

    // Rate limited: say so in plain language rather than leaking the raw message.
    if (r.status === 429) {
      const wait = Number(r.headers.get("retry-after")) || 0;
      console.warn("[chat]", p.name, "rate limited; retry-after", wait);
      return res.status(429).json({
        error: "The free AI tier is rate limited right now" +
          (wait ? " — try again in about " + Math.ceil(wait) + "s." : " — wait a few seconds and try again.") +
          " Shorter material keeps you under the limit.",
        retry_after: wait,
      });
    }

    if (!r.ok) {
      const detail =
        (data && data.error && (data.error.message || data.error.type || data.error.status)) ||
        (data && data.message) ||
        (typeof data.error === "string" ? data.error : "") ||
        JSON.stringify(data).slice(0, 200) ||
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
