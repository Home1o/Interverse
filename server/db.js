// Interverse — database layer (libSQL / Turso, with local file fallback)
// Resilient: schema init retries with backoff and NEVER blocks server startup.
const { createClient } = require("@libsql/client");
const path = require("path");

const url = process.env.TURSO_DATABASE_URL || "file:" + path.join(__dirname, "..", "interverse.db");
const authToken = process.env.TURSO_AUTH_TOKEN || undefined;

const client = createClient(authToken ? { url, authToken } : { url });

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    verified INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS otps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    code TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    mode TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_conv_user ON conversations(user_id, updated_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_otp_email ON otps(email, id DESC)`,
];

let dbOk = false;

async function initSchema() {
  for (const sql of SCHEMA) await client.execute(sql);
  // migration: profile column on users (ignore "duplicate column" on re-runs)
  try { await client.execute("ALTER TABLE users ADD COLUMN profile TEXT"); }
  catch (e) { if (!/duplicate column/i.test(e.message)) console.warn("[db] profile column:", e.message); }
  dbOk = true;
  console.log("[db] Ready →", url.startsWith("file:") ? "local file" : "Turso");
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error("timed out after " + ms + "ms")), ms)),
  ]);
}

// Try a few times quickly at boot, then keep retrying in the background.
// Resolves either way so the HTTP server is never blocked.
const dbReady = (async () => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try { await withTimeout(initSchema(), 8000); return client; }
    catch (e) {
      console.error(`[db] init attempt ${attempt}/3 failed:`, e.message);
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
  console.error("[db] STILL UNREACHABLE — server will run and retry every 30s. Check TURSO_DATABASE_URL / TURSO_AUTH_TOKEN, and that the Turso DB isn't archived.");
  const timer = setInterval(async () => {
    try { await withTimeout(initSchema(), 8000); clearInterval(timer); console.log("[db] recovered ✓"); }
    catch (e) { console.error("[db] retry failed:", e.message); }
  }, 30000);
  return client;
})();

function isDbOk() { return dbOk; }

module.exports = { client, dbReady, isDbOk };
