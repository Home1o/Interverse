# Interverse

**Your AI interview room.** Speak your answers, get grilled by an AI interviewer, and get scored feedback — with accounts, email OTP verification, and a database of saved sessions.

Built on the same stack as Paheyli: **Express + libSQL/Turso + JWT + email OTP**, zero-build vanilla JS frontend. Deploys on Render the same way.

## Features

- **Three practice modes** — Interview Drill, Confidence Coach, Vocabulary Builder
- **Voice conversation** — browser mic in (Web Speech API), spoken questions out
- **Feed your material** — resume, essays, JD; the interviewer works from it
- **Accounts** — register → 6-digit OTP emailed → verify → sign in (JWT, 30 days)
- **Saved sessions** — left sidebar library; save mid-session or auto-save on feedback; reopen, continue, or delete
- **Scored feedback** — clarity / structure / confidence / vocabulary out of 10, strengths, fixes, weak→strong phrase upgrades
- **Server-side AI proxy** — works with **Groq (free)**, **Gemini (free)**, or Anthropic; the key never reaches the browser

## Run locally

```bash
npm install
cp .env.example .env        # put your GROQ_API_KEY in .env (free at console.groq.com)
npm start                   # http://localhost:3000
```

With no SMTP configured, **OTP codes print in the server console** (and appear in the UI in dev mode) — so you can test signup end to end without an email provider. With no Turso configured, data goes to a local `interverse.db` file.

> Voice input needs Chrome (desktop or Android). Everything else works in any modern browser.

## Deploy on Render (same as Paheyli)

1. Push this folder to a GitHub repo (VS Code Source Control panel, or GitHub web upload).
2. Render → **New → Web Service** → connect the repo.
   - Build command: `npm install`
   - Start command: `npm start`
3. Add environment variables in Render:

| Variable | Value |
|---|---|
| `GROQ_API_KEY` | free key from console.groq.com (or `GEMINI_API_KEY` from aistudio.google.com, or `ANTHROPIC_API_KEY`) |
| `JWT_SECRET` | any long random string |
| `NODE_ENV` | `production` (hides dev OTP hints) |
| `TURSO_DATABASE_URL` | from your Turso dashboard |
| `TURSO_AUTH_TOKEN` | from your Turso dashboard |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `FROM_EMAIL` | your email provider |

**Turso is strongly recommended on Render** — the free tier's disk is wiped on every redeploy, so the local SQLite fallback would lose users and history. You already have a Turso account from Paheyli; just create a second database there.

**Email:** Brevo (free: 300 emails/day) or a Gmail app password both work. Until SMTP is set, codes only appear in Render's log stream (Dashboard → Logs).

## Project structure

```
server/
  index.js                 Express entry + SPA fallback
  db.js                    libSQL client (Turso or local file), schema
  mailer.js                OTP email (SMTP or console fallback)
  middleware/auth.js       JWT sign/verify
  routes/auth.js           register / verify-otp / resend-otp / login
  routes/conversations.js  per-user saved sessions (list/get/upsert/delete)
  routes/chat.js           server-side AI proxy (Groq / Gemini / Anthropic)
public/
  index.html               shell: auth screen + sidebar + main pane
  styles.css               Interverse identity (mist/ink/teal, Fraunces)
  app.js                   SPA: auth, sidebar, voice engine, feedback
```

## API summary

All under `/api`. Conversations and chat require `Authorization: Bearer <token>`.

- `POST /auth/register` `{email,name,password}` → sends OTP
- `POST /auth/verify-otp` `{email,code}` → `{token,user}`
- `POST /auth/resend-otp` `{email}`
- `POST /auth/login` `{email,password}` → `{token,user}` or `needVerify`
- `GET /conversations` · `GET /conversations/:id` · `PUT /conversations/:id` · `DELETE /conversations/:id`
- `POST /chat` `{system,messages,max_tokens}` → `{text}`
