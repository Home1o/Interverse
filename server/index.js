// Interverse — server entry
// The HTTP server starts IMMEDIATELY; the database connects (and self-heals)
// in the background. A slow or sleeping Turso can no longer take the site down.
require("dotenv").config();
const express = require("express");
const path = require("path");
const { client, isDbOk } = require("./db");

const app = express();
app.use(express.json({ limit: "600kb" }));

// GET /api/health — one-click diagnosis: DB reachability + SMTP status + latency
app.get("/api/health", async (req, res) => {
  const t0 = Date.now();
  const { checkMail } = require("./mailer");
  const mail = await checkMail();
  try {
    await client.execute("SELECT 1");
    res.json({ server: "ok", db: "ok", schema: isDbOk() ? "ready" : "pending", ...mail, ms: Date.now() - t0 });
  } catch (e) {
    res.status(500).json({ server: "ok", db: "fail", error: e.message, ...mail, ms: Date.now() - t0 });
  }
});

app.use("/api/auth", require("./routes/auth"));
app.use("/api/conversations", require("./routes/conversations"));
app.use("/api/insights", require("./routes/insights"));
app.use("/api/chat", require("./routes/chat"));

app.use(express.static(path.join(__dirname, "..", "public")));
// SPA fallback (Express 5 safe)
app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    return res.sendFile(path.join(__dirname, "..", "public", "index.html"));
  }
  next();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`[interverse] listening on :${PORT}`));

// safety nets: never let a stray rejection kill the process silently
process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e && e.message));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e && e.message));
