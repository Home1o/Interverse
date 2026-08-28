// Interverse — speech-to-text.
//
// The browser's Web Speech API decides on its own when an utterance has ended,
// and cannot be resumed without a gap of several hundred milliseconds in which
// the microphone is simply not captured. A candidate who pauses to think loses
// the first words of whatever they say next. It also handles Indian English
// unevenly and mangles code-switching outright.
//
// So the browser records continuously with MediaRecorder and posts the clip
// here. Whisper is far stronger on accents, background noise and jargon, and
// because the recorder never stops there is no gap to lose words in.
//
// Groq's free tier covers 28,800 audio seconds a day — roughly fifty sessions.
const express = require("express");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// Chosen for accuracy, not speed: large-v3 handles accented English and
// code-switching better than turbo, and at 200x+ real time even a two-minute
// answer comes back in well under a second. AI_STT_MODEL overrides it.
const MODEL_CHAIN = ["whisper-large-v3", "whisper-large-v3-turbo"];

// The audio travels inside a JSON body, so the real ceiling is express.json's
// limit in index.js, not Groq's 25MB. At ~30kbps Opus this is about six minutes
// of speech — far longer than any single answer.
const MAX_BYTES = 1_600_000;
const MIN_BYTES = 2000;               // ~0.2s of opus: below this there is no speech
const MAX_PROMPT = 800;               // Whisper ignores prompts beyond ~224 tokens

const dead = new Set();

function chain() {
  const override = process.env.AI_STT_MODEL;
  const all = override ? [override].concat(MODEL_CHAIN) : MODEL_CHAIN.slice();
  const live = all.filter((m) => !dead.has(m));
  return live.length ? live : all;
}

function isGoneError(status, text) {
  const m = String(text || "").toLowerCase();
  return (status === 404 || status === 400) &&
    (m.includes("does not exist") || m.includes("decommission") || m.includes("model_not_found"));
}

/* Whisper accepts a prompt for context. Seeding it with the candidate's own
   material means their name, their company and their project jargon come back
   spelled correctly instead of phonetically guessed. */
function buildPrompt(hint) {
  const base = "A candidate answering a job interview question in Indian English.";
  const extra = String(hint || "").replace(/\s+/g, " ").trim();
  if (!extra) return base;
  return (base + " Context: " + extra).slice(0, MAX_PROMPT);
}

router.post("/", async (req, res) => {
  if (!process.env.GROQ_API_KEY)
    return res.status(500).json({ error: "Speech-to-text needs GROQ_API_KEY set." });

  const { audio, mime, hint, language } = req.body || {};
  const m = /^data:(audio\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i.exec(String(audio || "").trim());
  if (!m) return res.status(400).json({ error: "No audio received" });

  let bytes;
  try { bytes = Buffer.from(m[2], "base64"); }
  catch (e) { return res.status(400).json({ error: "Audio could not be decoded" }); }

  // Whisper hallucinates on silence — a near-empty clip reliably comes back as
  // "Thank you." or similar. Refuse rather than invent words the person never said.
  if (bytes.length < MIN_BYTES) return res.json({ text: "", empty: true });
  if (bytes.length > MAX_BYTES) return res.status(413).json({ error: "That recording is too long — try a shorter answer" });

  const type = mime && /^audio\//.test(mime) ? mime : m[1];
  const ext = /ogg/.test(type) ? "ogg" : /mp4|m4a|aac/.test(type) ? "m4a" : /wav/.test(type) ? "wav" : "webm";

  const models = chain();
  let lastErr = "";
  for (let i = 0; i < models.length; i++) {
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: type }), "answer." + ext);
    form.append("model", models[i]);
    form.append("response_format", "json");
    form.append("temperature", "0");
    form.append("language", (language || "en").slice(0, 5));
    form.append("prompt", buildPrompt(hint));

    let r, body;
    try {
      r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST",
        headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY },
        body: form,
      });
      body = await r.text();
    } catch (e) {
      console.error("[transcribe] network", e.message);
      return res.status(502).json({ error: "Couldn't reach the transcription service" });
    }

    if (isGoneError(r.status, body)) {
      dead.add(models[i]);
      console.warn("[transcribe] model", models[i], "is gone; falling back");
      lastErr = body;
      continue;
    }

    if (r.status === 429) {
      const wait = Number(r.headers.get("retry-after")) || 0;
      return res.status(429).json({
        error: "Transcription is rate limited right now" + (wait ? " — try again in about " + Math.ceil(wait) + "s." : "."),
        retry_after: wait,
      });
    }

    if (!r.ok) {
      console.error("[transcribe]", models[i], r.status, String(body).slice(0, 200));
      lastErr = body;
      break;
    }

    let data = {};
    try { data = JSON.parse(body); } catch (e) {}
    const text = String(data.text || "").trim();

    // Second silence guard: Whisper's stock hallucinations on near-empty audio
    // are a small, well-known set. A clip this short saying only one of them
    // is far more likely to be silence than speech.
    const junk = /^(thank you\.?|thanks for watching\.?|you\.?|bye\.?|\.|♪+)$/i;
    if (!text || (bytes.length < 12000 && junk.test(text))) return res.json({ text: "", empty: true });

    return res.json({ text: text, model: models[i] });
  }

  res.status(502).json({ error: "Transcription failed: " + String(lastErr).slice(0, 160) });
});

module.exports = router;
