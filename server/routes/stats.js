// Interverse — read side of visit tracking.
//
// Collected data nobody looks at is just storage cost, so this turns the visits
// table into the three numbers that actually change decisions pre-launch:
// where people leave, how many come back, and what the funnel loses at each step.
//
// Gated on ADMIN_EMAIL. Without that set the endpoint is off entirely — better
// than shipping an open analytics dump.
const express = require("express");
const { client } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();
router.use(requireAuth);

router.use((req, res, next) => {
  const admin = (process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  if (!admin) return res.status(404).json({ error: "Not enabled" });
  if (String(req.user.email || "").toLowerCase() !== admin)
    return res.status(403).json({ error: "Not allowed" });
  next();
});

const rows = (r) => (r && r.rows ? r.rows : []);

router.get("/", async (req, res) => {
  const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
  const since = `-${days} days`;

  try {
    const [totals, exits, funnel, returning, daily, devices, refs] = await Promise.all([
      client.execute({
        sql: `SELECT COUNT(*) AS visits,
                     COUNT(DISTINCT visitor_id) AS visitors,
                     COUNT(DISTINCT user_id) AS signed_in,
                     CAST(AVG(seconds) AS INT) AS avg_seconds,
                     CAST(AVG(screens) AS INT) AS avg_screens
              FROM visits WHERE started_at >= datetime('now', ?)`,
        args: [since],
      }),

      // Where people were when they left.
      client.execute({
        sql: `SELECT last_screen AS screen, COUNT(*) AS n,
                     CAST(AVG(seconds) AS INT) AS avg_seconds
              FROM visits WHERE started_at >= datetime('now', ?)
              GROUP BY last_screen ORDER BY n DESC`,
        args: [since],
      }),

      /* Funnel is per VISITOR, not per visit. Counted per visit it goes UP in
         places — someone who returns lands straight on setup without passing
         through sign-in again, so "reached setup" outruns "reached OTP" and the
         chart becomes nonsense. Rolling every visit for a person into one path
         first asks the question that actually matters: did this person ever
         get this far. */
      client.execute({
        sql: `SELECT
                COUNT(*) AS arrived,
                SUM(CASE WHEN j LIKE '%auth%'     THEN 1 ELSE 0 END) AS opened_auth,
                SUM(CASE WHEN j LIKE '%otp%'      THEN 1 ELSE 0 END) AS reached_otp,
                SUM(CASE WHEN j LIKE '%setup%'    THEN 1 ELSE 0 END) AS reached_setup,
                SUM(CASE WHEN j LIKE '%session%'  THEN 1 ELSE 0 END) AS started_session,
                SUM(CASE WHEN j LIKE '%feedback%' THEN 1 ELSE 0 END) AS finished_session
              FROM (SELECT visitor_id, GROUP_CONCAT(path, '>') AS j
                    FROM visits WHERE started_at >= datetime('now', ?)
                    GROUP BY visitor_id)`,
        args: [since],
      }),

      // How many times each visitor has been back.
      client.execute({
        sql: `SELECT bucket, COUNT(*) AS visitors FROM (
                SELECT visitor_id,
                       CASE WHEN COUNT(*) = 1 THEN '1 visit'
                            WHEN COUNT(*) = 2 THEN '2 visits'
                            WHEN COUNT(*) <= 5 THEN '3-5 visits'
                            ELSE '6+ visits' END AS bucket
                FROM visits WHERE started_at >= datetime('now', ?)
                GROUP BY visitor_id)
              GROUP BY bucket ORDER BY visitors DESC`,
        args: [since],
      }),

      client.execute({
        sql: `SELECT date(started_at) AS day, COUNT(*) AS visits,
                     COUNT(DISTINCT visitor_id) AS visitors
              FROM visits WHERE started_at >= datetime('now', ?)
              GROUP BY day ORDER BY day DESC LIMIT 60`,
        args: [since],
      }),

      client.execute({
        sql: `SELECT device, COUNT(*) AS n FROM visits
              WHERE started_at >= datetime('now', ?) GROUP BY device`,
        args: [since],
      }),

      client.execute({
        sql: `SELECT referrer, COUNT(*) AS n FROM visits
              WHERE started_at >= datetime('now', ?) AND referrer <> ''
              GROUP BY referrer ORDER BY n DESC LIMIT 15`,
        args: [since],
      }),
    ]);

    const t = rows(totals)[0] || {};
    const f = rows(funnel)[0] || {};
    const base = Number(f.arrived || 0);
    const pct = (n) => (base ? Math.round((Number(n || 0) / base) * 100) : 0);

    res.json({
      days,
      totals: t,
      funnel: [
        { step: "Arrived", n: base, pct: 100 },
        { step: "Opened sign-in", n: Number(f.opened_auth || 0), pct: pct(f.opened_auth) },
        { step: "Reached OTP", n: Number(f.reached_otp || 0), pct: pct(f.reached_otp) },
        { step: "Reached setup", n: Number(f.reached_setup || 0), pct: pct(f.reached_setup) },
        { step: "Started a session", n: Number(f.started_session || 0), pct: pct(f.started_session) },
        { step: "Finished a session", n: Number(f.finished_session || 0), pct: pct(f.finished_session) },
      ],
      exits: rows(exits),
      returning: rows(returning),
      daily: rows(daily),
      devices: rows(devices),
      referrers: rows(refs),
    });
  } catch (e) {
    console.error("[stats]", e.message);
    res.status(500).json({ error: e.message });
  }
});

/* Every visit for one visitor — "has this person been back, and what did they
   do each time". Useful when hand-recruiting the first users. */
router.get("/visitor/:id", async (req, res) => {
  try {
    const r = await client.execute({
      sql: `SELECT id, user_id, device, referrer, path, last_screen, screens, seconds, started_at
            FROM visits WHERE visitor_id = ? ORDER BY started_at DESC LIMIT 100`,
      args: [String(req.params.id).slice(0, 40)],
    });
    res.json({ visits: rows(r) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
