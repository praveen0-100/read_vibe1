# ReadVibe

An AI-powered reading ecosystem: immersive Reader / Zen / Vibe modes, a document-grounded AI companion,
multi-tone audiobooks, a collaborative recording studio and a Research Studio that goes from topic to a
cited, exportable paper.

**Stack:** React 19 + Vite (frontend) · FastAPI + SQLAlchemy (Python API) · SQLite or PostgreSQL · free AI (no key needed).

## Quick start (Windows)

```powershell
# 1. API — terminal 1
cd backend
py -m venv .venv
.venv\Scripts\python -m pip install -r requirements.txt
.venv\Scripts\python run.py            # http://localhost:5000  (docs: /api/docs)

# 2. Web — terminal 2 (project root)
npm install
npm run dev                            # http://localhost:5173  (proxies /api → :5000)
```

Open the app and choose **Explore the demo library**, or create an account. A demo account
(`demo@readvibe.app` / `readvibe123`) is seeded on first start with sample books, highlights, notes,
reading history and an audiobook.

Run the API tests with `npm run api:test` (or `cd backend && .venv\Scripts\python -m pytest`).

## Configuration

Copy `backend/.env.example` to `backend/.env`. All settings use the `READVIBE_` prefix.

| Setting | Purpose |
|---|---|
| `READVIBE_JWT_SECRET` | **Required in production** (the API refuses to start with the default). |
| `READVIBE_GOOGLE_CLIENT_ID` | Enables **Sign in with Google** (see below). |
| `READVIBE_LLM_BASE_URL` / `_API_KEY` / `_MODEL` | Optional. Your own OpenAI-compatible LLM, tried first. AI features otherwise use free key-less public endpoints, then the built-in local engine. |
| `READVIBE_LLM_ENABLED` | `false` turns off every network LLM (local engine only). |
| `READVIBE_DATABASE_URL` | SQLite by default; any SQLAlchemy URL (e.g. PostgreSQL). |
| `READVIBE_MAX_UPLOAD_MB` | Upload limit — default **5120 (5 GB)**. |
| `READVIBE_CORS_ORIGINS` | JSON list of allowed frontend origins. |

Frontend: set `VITE_API_URL` (e.g. `https://api.example.com/api`) when the API is on another origin.

### Google sign-in

1. Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID** → *Web application*.
2. Under **Authorized JavaScript origins** add every frontend origin, e.g. `http://localhost:5173` and your production URL.
3. Set `READVIBE_GOOGLE_CLIENT_ID=<client id>` for the API and restart it. The login page then shows the Google button.

The browser receives a Google-signed ID token; the API verifies its signature, audience, issuer, expiry and
verified email before signing the user in. First-time Google users get an account automatically; an existing
account with the same verified email is linked. Google-only users can add a password later in Settings → Account.

### Large uploads (up to 5 GB)

Uploads stream to disk in 4 MB chunks, so memory stays flat regardless of file size, and the limit is enforced
mid-stream. Processing runs as a background job with progress in the notification centre. Readable text is capped
at about 32 MB (around 5 million words, far beyond any book); the full original file is always kept and downloadable.
Behind a reverse proxy, raise its body limit too — `deploy/nginx.conf` sets `client_max_body_size 5g`.

## Features

- **Library** — upload PDF, EPUB, DOCX, TXT, Markdown, HTML and RTF files or paste text. Automatic chapter detection, tags, favorites, pins, grid and list views, sorting, and offline copies (IndexedDB).
- **Reader** — typography controls (six fonts including OpenDyslexic, size, spacing, width, alignment, page colours), highlights in five categories with notes, bookmarks, in-document search, read-aloud with paragraph tracking, a focus line and reading ruler, keyboard shortcuts, and progress sync.
- **Zen mode** — generative ambient soundscapes (rain, forest, ocean, café, fireplace, binaural focus beats) with a mixer, scene presets, and a Pomodoro timer that logs focus sessions.
- **Vibe mode** — your own local music files or generative lo-fi stations, with a visualiser driven by the live audio and adjustable contrast and animation.
- **AI companion** — summaries at three depths, explanations in five styles, chat with citations, interactive mind maps, flowchart/concept/block diagrams (PNG, SVG, HTML and Mermaid export), quizzes with flashcards, visual references, concept comparison and a dictionary.
- **Audio Studio** — Humor, Tough and Regular narration; speed 0.5–3×; ±10/30-second skips; sleep timer; bookmarks; resume. The **collaborative studio** handles collaborators, chapter assignments, microphone recording with a teleprompter, cleanup and normalisation, stitching, and WAV export.
- **Research Studio** — discovery across Semantic Scholar, Crossref and OpenAlex with filters; an outline; a section editor with AI actions, autosave and version history; APA, IEEE and MLA citations; a similarity and citation review; DOCX, PDF and Markdown export.
- **Notebook** — notes, highlights and saved AI outputs; search and filters; flashcard study mode; Markdown export.
- **Platform** — JWT auth plus Google sign-in, rate limiting, request IDs, background jobs, global search, stats and streaks, data export and account deletion, light, dark and high-contrast themes, reduced motion, and a responsive mobile layout.

## Deploy

- **Docker:** `npm run build && docker compose up --build`, then open http://localhost:8080.
- **Vercel (frontend):** unchanged (`vercel.json`). Deploy the API separately (Docker, Render, Railway, Fly…) and set `VITE_API_URL`.
