// Interverse — coaching insights: personal memory + anonymized community patterns.
// Personal: this user's recent scores, improvement areas, and weak phrases.
// Community: weak→strong phrase pairs aggregated across ALL users (no transcripts,
// no identities — only the phrase pairs from generated feedback).
const express = require("express");
const { client, dbReady } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

// simple in-memory cache for the community aggregate (recomputed every 10 min)
let communityCache = { at: 0, data: [] };

function safeParse(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function norm(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 80); }

async function buildCommunity() {
  if (Date.now() - communityCache.at < 10 * 60 * 1000) return communityCache.data;
  const r = await client.execute(
    "SELECT data FROM conversations ORDER BY updated_at DESC LIMIT 300"
  );
  const counts = {};
  for (const row of r.rows) {
    const d = safeParse(row.data);
    const pp = d && d.feedback && Array.isArray(d.feedback.power_phrases) ? d.feedback.power_phrases : [];
    for (const p of pp) {
      const w = norm(p.weak), s = String(p.strong || "").trim().slice(0, 100);
      if (!w || !s) continue;
      if (!counts[w]) counts[w] = { weak: w, strong: s, count: 0 };
      counts[w].count++;
    }
  }
  const top = Object.values(counts)
    .filter((x) => x.count >= 2)          // only genuinely recurring patterns
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  communityCache = { at: Date.now(), data: top };
  return top;
}

// GET /api/insights — coaching memory for the current user + community patterns
router.get("/", async (req, res) => {
  try {
    await dbReady;
    const r = await client.execute({
      sql: "SELECT data, updated_at FROM conversations WHERE user_id=? ORDER BY updated_at DESC LIMIT 10",
      args: [req.user.id],
    });
    const scores = [], improvements = [], weakPhrases = [];
    for (const row of r.rows) {
      const d = safeParse(row.data);
      const fb = d && d.feedback;
      if (!fb) continue;
      if (fb.scores && scores.length < 5) scores.push(fb.scores);
      for (const imp of (fb.improvements || [])) {
        const t = String(imp).slice(0, 160);
        if (improvements.length < 6 && improvements.indexOf(t) === -1) improvements.push(t);
      }
      for (const p of (fb.power_phrases || [])) {
        const w = norm(p.weak);
        if (w && weakPhrases.length < 8 && weakPhrases.indexOf(w) === -1) weakPhrases.push(w);
      }
    }
    const community = await buildCommunity().catch(() => []);
    res.json({
      personal: { sessions: r.rows.length, scores, improvements, weak_phrases: weakPhrases },
      community: { common_upgrades: community },
    });
  } catch (e) {
    console.error("[insights]", e.message);
    // never block a session on insights — return empty
    res.json({ personal: { sessions: 0, scores: [], improvements: [], weak_phrases: [] }, community: { common_upgrades: [] } });
  }
});

module.exports = router;
