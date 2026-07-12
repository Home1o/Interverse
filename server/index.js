// Interverse — server entry
require("dotenv").config();
const express = require("express");
const path = require("path");
const { dbReady } = require("./db");

const app = express();
app.use(express.json({ limit: "600kb" }));

app.use("/api/auth", require("./routes/auth"));
app.use("/api/conversations", require("./routes/conversations"));
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
dbReady.then(() =>
  app.listen(PORT, () => console.log(`[interverse] listening on :${PORT}`))
);
