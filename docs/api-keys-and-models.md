# AI providers & models

The AI features — project analysis, codebase scanning, instrumentation,
insights — need a model to run on. DotChart supports three providers; pick
one in the Connect wizard (first run) or under **⚙ Settings** any time.
Everything else (the grid, CSV import, database import, live tracking)
works with no AI configured at all.

## Claude (recommended)

The best results on code analysis. Create a key at
[console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys)
and paste it where DotChart asks.

- **Claude Sonnet 5** (default) — near-Opus quality at ~40% of the cost
  ($3 in / $15 out per MTok).
- **Claude Opus 4.8** — highest quality, for very large or tangled
  codebases ($5 in / $25 out per MTok).

## OpenAI

Use the key you already have
([platform.openai.com/api-keys](https://platform.openai.com/api-keys)).

- **GPT-5.6 Terra** (default) — balanced intelligence/cost ($2.50 / $15).
- **GPT-5.6 Luna** — fast and cheap; fine for insights, weaker on big
  codebases ($1 / $6).
- Any other model id can be typed in Settings (e.g. `gpt-5.6` for the
  flagship).

## Local & free — Ollama

No key, no cost, and nothing leaves your machine. Install
[Ollama](https://ollama.com), pull a model (`ollama pull qwen3:8b` to
start), and DotChart auto-detects it. Expectations: local models are
noticeably weaker than Claude on large codebases — DotChart trims the code
digest to fit local context windows, and bigger models (30B+) give much
better event plans. Great for trying DotChart out and for insights.

**Using a hosted DotChart with your local Ollama:** the dashboard may run
on a server, but the page runs in *your* browser — so the AI call runs
directly against your machine. Two one-time steps:

1. Start Ollama with the app's origin allowed:
   `OLLAMA_ORIGINS=https://your-dotchart-host ollama serve`
2. When Chrome asks for **local network access**, allow it.

Your code digest goes to your DotChart server (as with any hosted
analysis), but the model itself runs locally and no cloud AI ever sees it.

**Remote Ollama:** a GPU box on your LAN or a tunneled URL also works —
set the Ollama URL in ⚙ Settings. Ollama has no built-in auth, so expose
it via a tunnel with access control (Tailscale, Cloudflare Access) rather
than the open internet.

## Where keys live

Keys are stored only in your browser and sent per request. Alternatively,
whoever runs the server can set shared keys in its environment (or a
`.env` file next to the app):

```sh
ANTHROPIC_API_KEY=sk-ant-…
OPENAI_API_KEY=sk-…
```

A key pasted in Settings overrides the server key.

## Cost

Every analysis reports what it actually cost when it finishes. Typical: a
project analysis or codebase scan runs a few tens of cents; insight cards
cost a few cents. Ollama runs are free.
