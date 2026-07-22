# Self-hosting

A hosted DotChart gives your team an always-on dashboard and a stable
ingest URL for production apps.

## One-click: Render

The repo ships a `render.yaml` Blueprint — use the **Deploy to Render**
button in the README, or point Render's Blueprint flow at your fork. It
provisions the service plus a persistent disk for `~/.dotchart` (tracked
events and saved projects survive deploys).

## Docker

```sh
docker build -t dotchart .
docker run -p 5300:5300 -v dotchart-data:/root/.dotchart \
  -e DOTCHART_HOSTED=1 -e DOTCHART_PASSWORD=changeme \
  -e ANTHROPIC_API_KEY=sk-ant-... dotchart
```

## Any Node host

```sh
npm ci && npm run build
DOTCHART_HOSTED=1 DOTCHART_PASSWORD=… ANTHROPIC_API_KEY=… npm start
```

## Environment variables

- `PORT` — listen port (default 5300).
- `DOTCHART_HOSTED=1` — hosted mode: disables machine-local features
  (server-side folder browsing, applying git branches, localhost
  databases). Connect works via GitHub or the browser folder picker.
- `DOTCHART_PASSWORD` — **set this on any public deployment.** Everything
  except `/ingest` and `/health` requires it; visitors get a lock screen.
  Ingest stays open by design — it's validated and capped.
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — optional shared keys for AI
  analysis; users can also bring their own key (or use local Ollama) in
  ⚙ Settings.

## What's different in hosted mode

The dashboard, ingest, database import, insights, and saved projects all
work the same. Machine-local operations (browsing the server's filesystem,
creating instrumentation branches) are disabled — do those with a local
DotChart, then point the instrumented app's `DOTCHART_INGEST_URL` at your
hosted instance.
