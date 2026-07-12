// Interverse — database layer (libSQL / Turso, with local file fallback)
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

const dbReady = (async () => {
  for (const sql of SCHEMA) await client.execute(sql);
  console.log("[db] Ready →", url.startsWith("file:") ? "local file" : "Turso");
  return client;
})();

module.exports = { client, dbReady };
