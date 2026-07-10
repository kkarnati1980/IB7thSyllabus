# Jarvis — IB MYP Self-Learning Tutor

A voice-enabled, IB MYP self-learning tutor for a Grade 7 student, built as a **Next.js full-stack app**. It's the production-shaped implementation of the Claude Design prototype in [`project/Jarvis Tutor.dc.html`](project/Jarvis%20Tutor.dc.html) (the design conversation is in [`chats/`](chats), and the original handoff brief is in [`HANDOFF.md`](HANDOFF.md)).

Jarvis embodies the full 14-step IB MYP pedagogy — inquiry before explanation, a 5-layer progressive explanation, IB conceptual lens (key/related concept, global context, statement of inquiry) + ATL skills, misconception checks, mastery checkpoints, reflection and reinforcement — and makes that method **visible** as a live "learning canvas". Every explanation is grounded in the syllabus via retrieval, and the tutor self-populates from its own IB MYP Grade 7 knowledge when retrieval is sparse.

## Features

- **Voice both ways** — browser speech-to-text (tap the mic to interrupt Jarvis mid-sentence) and auto-read text-to-speech with a mute toggle. Messages sent while Jarvis is thinking are queued, not dropped.
- **Guided lessons** — a real Claude tutor (server-proxied) beside a five-tab learning canvas:
  - **Canvas** — concept map → inquiry → 5-layer explanation → IB lens → misconceptions → checkpoint → reinforcement → reflection, populated live.
  - **Quiz** — 6 IB MYP-style questions (recall / application / analysis), auto-scored, explanations revealed.
  - **Flashcards** — 10 flip cards per topic (term / definition / example / IB link).
  - **Videos** — 6 concept-specific YouTube resources with channel, timestamp and reason.
  - **Mind Map** — a colour-coded branching map of the topic.
- **Home dashboard** — subjects with progress rings, a "continue learning" card, and a spaced-repetition "revision due" queue.
- **Syllabus Library** — drag-and-drop `.md` files (plus a Drive-link field) indexed **server-side** with TF-IDF retrieval.
- **Progress tracker** — mastery per topic, misconceptions log, and a spaced-repetition schedule, persisted per user.
- **Accounts & admin** — real backend auth (scrypt-hashed passwords, server-side sessions in httpOnly cookies), an **admin portal** reached at `/admin`, full user management (create / edit / enable-disable / delete), and an immutable audit log. Default admin: **`admin` / `password`**.

## Tech

- **Next.js 15** (App Router) + React 19 + TypeScript.
- **SQLite** (`better-sqlite3`) for users, sessions, audit log, syllabus chunks and progress — file-based, zero external services. Auto-created and seeded on first run under `data/` (gitignored).
- **`@anthropic-ai/sdk`** for the tutor and study-tool generation. The API key stays **server-side only**; the browser never sees it. Model defaults to `claude-opus-4-8` (override with `JARVIS_MODEL`).
- Browser Web Speech API for STT/TTS (client-side; needs Chrome or Safari with mic permission).

## Getting started

```bash
npm install
cp .env.example .env.local     # then add your ANTHROPIC_API_KEY
npm run dev                    # http://localhost:3000
```

- Student app: <http://localhost:3000/> — sign in or create an account.
- Admin portal: <http://localhost:3000/admin> — log in with `admin` / `password`.

Without an `ANTHROPIC_API_KEY`, the whole app runs (auth, syllabus, tracker, admin) and the LLM-powered tabs surface a friendly error instead of generating.

### Production build

```bash
npm run build
npm start
```

## How the routes map

| Route | Purpose |
| --- | --- |
| `/` | Student login/registration, then the tutor app (home · library · tracker · lesson) |
| `/admin` | Admin login, then the admin portal (users · audit log) |
| `/api/auth/*` | login · register · logout (session cookie) |
| `/api/me` | bootstrap: current user + subjects + progress |
| `/api/syllabus` | list / upload `.md` files (server-side RAG index) |
| `/api/tutor` | one tutor turn — RAG-grounded, returns spoken reply + canvas scaffold |
| `/api/quiz` · `/api/flashcards` · `/api/videos` · `/api/mindmap` | study-tool generation |
| `/api/progress` | persist mastery / misconceptions |
| `/api/admin/users` · `/api/admin/users/[id]` · `/api/admin/audit` | admin management (admin-only) |

## Notes & follow-ons

- **SOC2 / production auth.** Passwords are scrypt-hashed with per-user salts, sessions are opaque server-side tokens in httpOnly cookies, access is role-gated, and every security event is written to an immutable audit log. For a real SOC2 posture you'd add rate-limiting, MFA, password-reset, secret rotation and a managed database — the data model here is built to carry that.
- **Google Drive sync** is presented in the UI but powered by local upload; a Drive-synced ingestion job is a follow-on server integration.
- **RAG** uses server-side TF-IDF over heading-chunked markdown — a faithful, dependency-light index. Swapping in vector embeddings (e.g. via an embeddings API) is a drop-in upgrade to `retrieve()` in `lib/db.ts`.
- The syllabus is shared curriculum (admin-managed); progress is per student.
