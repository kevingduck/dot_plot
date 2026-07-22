# Troubleshooting

## "No API key" or the analyze button is disabled

AI analysis needs a configured provider: a Claude or OpenAI key, or a
running Ollama. Set one up in the Connect wizard when prompted, or under
**⚙ Settings** — see **AI providers & models**. If your team runs a shared
server, the admin can set `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in its
environment instead.

## DotChart can't see my Ollama

1. Is it running? `curl localhost:11434/api/tags` should return JSON.
2. Using a hosted DotChart? Ollama must allow the app's origin — restart
   it with `OLLAMA_ORIGINS=https://your-dotchart-host ollama serve` — and
   Chrome will ask for local-network permission the first time (allow it).
3. Remote Ollama (LAN box, tunnel): put its URL in ⚙ Settings and hit
   "Detect models".

## My tracked events don't appear

1. Is `DOTCHART_INGEST_URL` set in the *instrumented app's* environment
   (not DotChart's)? Without it the client is deliberately a no-op.
2. Does it point at the right host? `curl https://your-host/health` should
   return `{"ok":true,…}` and `events_stored` should grow as events arrive.
3. The grid polls every ~15 seconds — give it a moment, and check the
   **● N tracked events** chip in the status bar.

## The wizard found a localhost database but I'm on a hosted DotChart

A server can't reach `localhost` on your laptop. Either run DotChart
locally for that project, or connect a cloud database URL.

## Database import found no events

The import window defaults to the last 90 days — raise the "last N days"
number in the wizard's final step. Also check the table mappings: the
event tables need a user column and a timestamp column.

## I imported the wrong thing / want to start over

- **Data ▾ → Clear tracked events** empties the ingest store (careful:
  that's real tracked data, all projects).
- **Projects ▾ → ✕** forgets a saved project workspace.
- Loading the demo never overwrites a saved project — demo data is kept
  strictly separate.

## Something else

DotChart's server logs (`[dotchart] …` lines in the terminal, or your
host's log view) usually name the failing step. File issues at
github.com/kevingduck/dot_plot.
