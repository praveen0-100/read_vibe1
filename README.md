# ReadVibe

Industrial-style Vite + React (JavaScript) frontend and Flask REST API for an AI-powered immersive reading workspace.

## Run locally

```bash
npm install
npm run dev
```

In another terminal:

```bash
python -m venv .venv
.venv\\Scripts\\activate
pip install -r backend/requirements.txt
python backend/app.py
```

The frontend currently includes an intentional polished demo data layer so the workspace is usable before external AI, TTS, search, storage, and auth providers are configured. The `API` constant in `src/main.jsx` points to `http://localhost:5000/api`; wire the provided endpoints into the UI actions as you connect real providers.
