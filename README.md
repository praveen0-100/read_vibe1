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

## Playback, artwork & sources (Nov 2026 upgrade)

- **One global player** — `src/features/playback/` (`PlaybackHost` in the app shell, `playbackStore`, `Player`). Audio keeps playing across pages; a mini player follows you; the full UI portals into the Audio Studio.
- **Queue** — `src/lib/queue.js`: whole-book and single-chapter entries (`id#chapter`), add / play next / reorder / remove / clear / shuffle / repeat, no duplicate chapters. Persisted locally and synced per account (`GET/PUT /api/playback/state`, last-writer-wins by timestamp; `playbackSync.js`).
- **Playlists & Library actions** — Play / Play next / Add to queue / Add to playlist / New playlist from every Library item.
- **Artwork** — EPUB covers are extracted on import; custom covers via `PUT /api/documents/{id}/cover` (content-sniffed, 4 MB cap); generated art remains the fallback.
- **Sources → artifacts** — `GET /api/sources/{id}/artifacts` lists everything generated from one upload with its provenance.
- **Jobs** — `POST /api/jobs/{id}/cancel` (a cancelled job never ends "ready").
- **Reader** — running book title, tap-to-cycle footer (minutes left / location / pages left), page-grid navigator with "Back to N", Search on selection.
- **Tests / CI** — `npm test` (vitest), `cd backend && pytest`; `.github/workflows/ci.yml` runs both plus the build.

### Second pass: provenance, jobs, reader, languages

- **PDF page mapping** — PDF imports record the page of every paragraph (`Chapter.page_start/page_end/paragraph_pages`); `GET /api/documents/{id}/locate` returns a SourceLocator. The desktop reader has **Reader / Original / Split** for PDFs and the original follows the paragraph you click.
- **Claim checking** — `POST /api/research/verify` grades a statement against chosen sources (lexical evidence, labelled as such), returns quoted passages with chapter/paragraph/page, and flags sources that disagree or give different figures. UI: Research → Claim checker.
- **Audio Overview styles** — Deep Dive, Brief, Critique, Debate, Lecture, Revision; every statement is checked against the document and carries `source_refs` (only when the overview is in the document's own language).
- **Durable jobs** — jobs store their config, can be cancelled or retried (`/api/jobs/{id}/retry`), and jobs left running by a restart are re-queued or failed honestly on startup.
- **Languages** — Settings → Audio → Languages: reader, narration, AI answers and overview languages are chosen independently.

Not done: OCR for scanned PDFs (needs an OCR engine such as Tesseract on the server; scanned PDFs still get a clear error), EPUB/DOCX/PPTX original preview, bounding-box highlights, knowledge graph, presenter Q&A, Indic ASR/TTS evaluation (Project Vaani), an external task queue (Redis/RabbitMQ) and the measured quality benchmarks.

### Third pass: OCR, graph, presenter Q&A

- **OCR** — scanned PDFs are recognised automatically when the server has Tesseract + `pytesseract` + `pypdfium2` (`services/ocr.py`); otherwise the import fails with a message naming exactly what is missing. OCR'd documents are marked in their description and still get page mapping.
- **Original view for DOCX / text / Markdown** — `GET /api/documents/{id}/render` returns headings, paragraphs and tables as data; shown in the reader's Original/Split pane.
- **Knowledge graph** — `POST /api/research/graph`; Research → Knowledge graph. Nodes and links keep locators to their source paragraphs; shared concepts are ringed.
- **Presenter Q&A** — `POST /api/decks/{id}/ask`; the presenter view has an Audience Q&A card that answers from the slide and the source with citations, and says so when the source doesn't cover a question.
- **Benchmark** — `tests/test_studio.py::test_benchmark_*` measures citation correctness and false-support on a labelled fixture (a regression guard, not the 98%/95% product targets).

### Reader features guide (Kindle-style behaviours)

- **Annotations** — Highlight / Underline / Outline styles that stack on the same text (named colours: `marks` on a highlight, validated server-side), Pin, Share (native share or a link to the passage), Copy with a toast + Share action, Report extraction error (`POST /api/documents/{id}/reports`). Tap an annotation for Delete / Annotate / Look Up / Copy / Pin / Share / Report.
- **Look Up** — `GET /api/lookup?term=&lang=`: dictionary (English single words) + Wikipedia summary, cached 7 days, failures degrade per section; phrases skip the dictionary and offer "Explain with AI".
- **Outline** — `GET /api/documents/{id}/outline` (chapter offsets). **Settings** — letter spacing and an optional "About this book" card on first open.
- Already present from earlier passes: page-turn/curl in the paged reader, running header + cycling footer, page-grid navigator with "Back to N", bookmarks, Original/Split view, reading ruler, fonts incl. dyslexic-friendly.
- Not built: two-page landscape spreads, in-book image viewer (extraction keeps text only), scrubber live previews, continuous-scroll mode, community "popular highlights" (needs many users), offset-anchored offline sync queue, Flutter client.

### Platform hardening & study (production-grade additions)

- **Two-factor authentication** — TOTP (RFC 6238, verified against the RFC test vectors) with single-use recovery codes; the seed is encrypted at rest (Fernet) and a used code can't be replayed. Sign-in returns a short-lived, single-purpose `mfa_token` until the code is verified. Settings → Security.
- **Brute-force protection & audit trail** — lock an account for 15 min after 5 wrong passwords (`READVIBE_LOGIN_MAX_FAILURES`, `READVIBE_LOGIN_LOCKOUT_MINUTES`); unknown emails get an identical response and timing; every sign-in/lockout/2FA/password event is recorded and visible to the user (`GET /api/auth/security`).
- **Security headers** — CSP `default-src 'none'` on API responses, `X-Frame-Options`, COOP, Permissions-Policy, HSTS over HTTPS.
- **Observability** — `GET /api/metrics` (Prometheus text; disabled unless `READVIBE_METRICS_TOKEN` is set) with request counts and latency histograms labelled by route *template*, auth-event counters and job-state gauges; `GET /api/ready` readiness probe.
- **Idempotency keys** — `Idempotency-Key` on audiobook and deck creation replays the first result instead of starting a second job (24 h, per user, body-fingerprinted; a reused key with a different body is rejected). The web client sends one automatically.
- **Spaced repetition** — SM-2 scheduling with Again/Hard/Good/Easy, cards from highlights (cloze) or a document's key terms, streak/retention/maturity stats, keyboard review (Space, 1–4). `/study`.
- Production note: set a strong `READVIBE_JWT_SECRET` (it also derives the encryption key for 2FA seeds; rotating it makes users re-enrol 2FA) and `READVIBE_METRICS_TOKEN`.

### Responsive hardening (`src/styles/fit.css`)

Loaded last so it can settle conflicts between the older sheets. Verified with `scripts/layout-audit.js` (page-level overflow, content clipped by its container, overlapping controls/chrome, small tap targets) in iframes at 320×640, 360×740, 390×844, 844×390, 931×430, 768×1024, 820×1180, 1024×768, 1180×820, 1280×800, 1366×768 across every route.

- `100dvh` instead of `100vh` (the mobile URL bar no longer pushes the tab bar off-screen); `--mini-h` published by the playback host so no page ends under the mini player, tab bar or quick-action button.
- Reader header wraps instead of overlapping at tablet widths; mini player no longer covers the reader footer or side rails; reader footer label no longer swallows taps on the toolbar.
- Audio player grid can shrink (it was ~14px wider than a phone); queue/chapter rows wrap or ellipsise.
- Landscape phones: compact floating chrome; touch: larger hit areas without layout changes; `overscroll-behavior`, `scrollbar-gutter`, `content-visibility` on long grids, blur removed on small screens.

### Goals, collections, sharing, export and install

- **Reading goals** — daily minutes, days per week and flashcards per day (`/api/goals`, `/api/goals/progress`): progress ring, goal-based streak (an open day never breaks a streak), weekly target and a 12-week heatmap on Home.
- **Collections** — shelves of documents (many-to-many; deleting a shelf never deletes books). Library filter chips and "Add to collection" in each book's menu.
- **Duplicate detection** — every upload and pasted text is SHA-256 hashed (streamed, in the background job); an identical file is imported but flagged "Duplicate" with a link to the original. Per user only.
- **Share links** — public, read-only, expiring page of a book's highlights (`/s/<token>`), optional notes, instant revoke. Only a hash of the token is stored; unknown/expired/revoked links return the same 404.
- **Export** — highlights as Markdown/CSV, study cards as an Anki-importable file or CSV (formula-injection guarded).
- **Installable app (PWA)** — manifest + icons + service worker (`public/`): `/api/*` is never cached, hashed assets are cache-first, navigations are network-first with an offline page.

### Full screen book view

Reader, Zen and Vibe all have a **Full screen** button (header, or press `F`). It uses the browser Fullscreen API and switches to a distraction-free layout: sidebar, tab bars, floating buttons and side rails are hidden, the page is centred, and the header tucks away and slides back when the pointer/finger nears the top edge (the contents list opens as a slide-over). An **Exit** button, `F` or `Esc` leave; leaving fullscreen any other way also leaves book view. On phones the paged reader has "Full screen" in its ⋯ menu. Where the Fullscreen API is unavailable (e.g. iPhone Safari) the layout still applies without browser fullscreen.

### Phone polish (installed app)

Found by testing at 360×800 against a real-device screenshot: the mini player covered the last lines of the paged reader, the settings button sat over the text, briefing cards squeezed their text into ~100px columns beside a button, and tab strips scrolled a few pixels sideways. Fixed in `src/styles/fit.css`: the page now ends above a slimmer mini player (which fades while the reader toolbars are open), the settings button moved into the footer row, text rows wrap their buttons underneath, the touch hit-area rings no longer widen scroll strips. Full screen is in the phone reader's top bar and menu, the tablet/desktop header and on `F`. Scrolling: no pull-to-refresh / rubber-band chaining, no sideways wobble, text-size-adjust pinned, a Back-to-top button that glides, safe-area padding for notches, text selection preserved in the installed app. `scripts/layout-audit.js` now also reports squeezed text and text spilling out of its control.

### Add books (Discover → queue) and closing the mini player

- **✕ on the mini player** stops playback and hides it everywhere (including the Audio Studio's other tabs); pressing play again brings it back. It never floats over other features while closed.
- **Audio Studio → Queue → Add books**: pick several books from **My library** or **Discover** (Project Gutenberg, with genre chips and search). Catalogue books are imported (once — shared with the Discover page's import cache), narrated and queued **in the order you picked them** even though they finish at different times (`lib/batchQueue.js`); a failed book is skipped without blocking the rest. The first pick becomes Now playing when nothing has been listened to yet. "Also save as a playlist" keeps the same list as a playlist.
