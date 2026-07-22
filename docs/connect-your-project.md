# Connect your project

The Connect wizard is the main way into DotChart: point it at your project
and it does the rest.

## Pick your project

- **On this computer** — browse to your project folder (folders that look
  like projects get a badge). When DotChart runs on a server instead of your
  machine, the folder picker runs *in your browser*: it reads the folder
  locally and uploads only a filtered code digest — the project itself never
  leaves your machine.
- **From GitHub** — paste a repository URL. Private repos work via your
  local git credentials, or a one-time fine-grained access token
  (github.com → Settings → Developer settings → Fine-grained tokens →
  read-only access to that repo). The token is used once for the download
  and never stored.

## What the analysis does

DotChart detects your framework, finds the database connection in the repo's
env files (shown redacted; used **read-only**, and only with your consent),
and runs one Claude pass over the code *and* the live database schema. The
result is a ranked plan of events worth tracking, each labeled:

- **already in your database · table** — the event can be charted
  immediately from existing rows. Zero code changes.
- **needs a one-line code change** — the event doesn't exist yet; DotChart
  can write the tracking call for you, on a git branch (see
  **Instrumenting your code**).

Uncheck anything you don't want. Then **Show me my users** imports the
database-backed events and the grid shows your real users.

## After connecting

- The plan and data persist across reloads, saved per project. Switch
  projects from **Projects ▾** in the top bar.
- Reopen the plan any time with **Event plan** in the top bar.
- Database-connected projects get **↻ Refresh data** in the status bar — a
  fresh read-only import with the mappings you approved.
