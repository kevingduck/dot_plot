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
- `DOTCHART_AUTH=1` — **accounts mode**, the right choice for a shared
  deployment: users sign up / log in, each sees only their own projects,
  and every project gets its own ingest URL (`/ingest/<token>`). The
  first account created adopts any pre-accounts workspaces and events.
- `DOTCHART_SECRET` — session-signing secret for accounts mode (a random
  one is generated and persisted if unset — fine on a single instance
  with a disk).
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` — optional: enables
  "Continue with GitHub" on the login screen AND the repo picker ("Pick
  from your GitHub repos" — one-click connect of private repos and
  tokenless branch pushes; the OAuth token is stored encrypted). Register
  an OAuth app at github.com → Settings → Developer settings with
  callback URL `https://your-host/api/auth/github/callback`.
- `DOTCHART_FREE_ANALYSES` — optional: each new account may run this many
  AI analyses on the server's key before bringing their own (default 0).
  A credit is only consumed when the server key is actually used.
- `RESEND_API_KEY` (+ optional `RESEND_FROM`) — optional: enables
  "Forgot password?" reset emails via [resend.com](https://resend.com).
  Without it, reset an account from the server shell:
  `node scanner/reset-password.mjs user@example.com newpassword`.
- `DOTCHART_PASSWORD` — simpler alternative to accounts for a
  single-user/team deployment: one shared password, one shared workspace
  set. Ignored when `DOTCHART_AUTH=1`.
- `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` — optional shared keys for AI
  analysis; users can also bring their own key (or use local Ollama) in
  ⚙ Settings.

## What's different in hosted mode

The dashboard, ingest, database import, insights, and saved projects all
work the same. Machine-local operations (browsing the server's filesystem,
creating instrumentation branches) are disabled — do those with a local
DotChart, then point the instrumented app's `DOTCHART_INGEST_URL` at your
hosted instance.
