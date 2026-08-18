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

/* Groq retires model IDs on a few months' notice, and when one goes the app
   dies with "the model does not exist" until someone edits this file. So each
   role has a CHAIN of candidates: if one is gone, the next is tried and the
   working ID is remembered for the life of the process.

   Groq meters each model separately, so background scoring on a smaller model
   draws from its own token bucket instead of competing with the interview. */
const MODEL_CHAINS = {
  text:   ["openai/gpt-oss-120b", "qwen/qwen3.6-27b", "openai/gpt-oss-20b"],
  small:  ["openai/gpt-oss-20b", "openai/gpt-oss-120b"],
  vision: ["qwen/qwen3.6-27b", "openai/gpt-oss-120b"],
};

// Remembers which candidate actually worked, so a retired ID is tried once, not
// once per request.
const working = {};
// IDs Groq has told us are gone. Skipped on every later request.
const dead = new Set();

function chainFor(role) {
  const override = role === "vision" ? process.env.AI_VISION_MODEL
    : role === "small" ? process.env.AI_SMALL_MODEL
    : process.env.AI_MODEL;
  const chain = override ? [override].concat(MODEL_CHAINS[role]) : MODEL_CHAINS[role].slice();
  const live = chain.filter((m) => !dead.has(m));
  const good = working[role];
  if (good && live.includes(good)) return [good].concat(live.filter((m) => m !== good));
  return live.length ? live : chain;   // everything marked dead: try anyway rather than give up
}

// A retired model reports itself in a few different shapes depending on how far
// through decommissioning it is.
function isGoneError(status, data) {
  const msg = String((data && data.error && (data.error.message || data.error.code)) || "").toLowerCase();
  return (status === 404 || status === 400) &&
    (msg.includes("does not exist") || msg.includes("decommission") ||
     msg.includes("has been deprecated") || msg.includes("model_not_found"));
}

function pickProvider(hasImages, small) {
  if (process.env.GROQ_API_KEY)
    return { name: "groq", url: "https://api.groq.com/openai/v1/chat/completions",
      key: process.env.GROQ_API_KEY,
      role: hasImages ? "vision" : small ? "small" : "text",
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

  const small = req.body && req.body.tier === "small";
  const p = pickProvider(images.length > 0, small);
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
  // Vision models bill an image by area: roughly one token per 28x28 patch,
  // so a rendered A4 page is ~2,200 tokens, not the few hundred its file size
  // suggests. Under-counting here is what produced 429s during transcription.
  const imageCost = images.length * 2200;
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
  function buildRequest(model) {
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
    body = { model: model, max_tokens: maxTok, temperature: 0.5, system: sys, messages: msgs };
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
      model: model, max_tokens: maxTok, temperature: 0.5,
      response_format: { type: "json_object" },
      messages: [{ role: "system", content: sys }, ...msgs],
    };
    // The GPT-OSS models reason before answering. Interverse wants a fast spoken
    // reply, not a chain of thought that burns the token budget, so keep it low.
    if (/^openai\/gpt-oss/.test(model)) body.reasoning_effort = "low";
  }
  return { url, headers, body };
  }

  try {
    const chain = p.role ? chainFor(p.role) : [p.model];
    let url, headers, body, r, data, tried = [];

    // Walk the chain until one answers. A retired ID is recorded so later
    // requests skip it entirely.
    for (let i = 0; i < chain.length; i++) {
      ({ url, headers, body } = buildRequest(chain[i]));
      tried.push(chain[i]);
      r = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
      data = await r.json().catch(() => ({}));
      if (!isGoneError(r.status, data)) {
        if (r.ok && p.role) working[p.role] = chain[i];
        break;
      }
      dead.add(chain[i]);
      console.warn("[chat] model", chain[i], "is gone on", p.name + "; falling back");
    }
    if (isGoneError(r.status, data)) {
      console.error("[chat] every model in the", p.role, "chain was rejected:", tried.join(", "));
      return res.status(502).json({
        error: "None of the configured AI models are available any more (" + tried.join(", ") +
          "). Set AI_MODEL in the environment to a current Groq model ID \u2014 see console.groq.com/docs/models.",
      });
    }

    // If the call failed for ANY reason, retry once stripped back to the plainest
    // request the API accepts: no strict JSON mode, no reasoning control. This
    // covers both a model refusing to produce valid JSON and a newer model
    // rejecting a parameter an older one accepted.
    let salvaged = null;
    if (!r.ok && (body.response_format || body.reasoning_effort)) {
      salvaged = (data && data.error && data.error.failed_generation) || null;
      delete body.response_format;
      delete body.reasoning_effort;
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

    // Hand back what the call actually cost, plus Groq's own view of the
    // bucket. The client paces future requests off these rather than guesses.
    const usage = data.usage
      ? { total_tokens: Number(data.usage.total_tokens) || undefined,
          prompt_tokens: Number(data.usage.prompt_tokens) || undefined }
      : undefined;
    const num = (h) => { const v = Number(r.headers.get(h)); return Number.isFinite(v) ? v : undefined; };
    const limit = {
      limit_tokens: num("x-ratelimit-limit-tokens"),
      remaining_tokens: num("x-ratelimit-remaining-tokens"),
      reset_tokens: r.headers.get("x-ratelimit-reset-tokens") || undefined,
    };
    res.json({ text, usage, limit, model: body.model, bucket: p.role || "text" });
  } catch (e) {
    console.error("[chat]", p.name, e.message);
    res.status(502).json({ error: "Couldn't reach the AI service (" + p.name + ")" });
  }
});

module.exports = router;
