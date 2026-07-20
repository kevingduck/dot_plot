# DotChart

See what your users are actually doing — a dot-plot-first product analytics tool.

Inspired by David Lieb's "dot plot" technique (Bump, Google Photos): a 2D grid
where **every row is one user and every column is one day**, so individual usage
patterns — weekday-vs-weekend clusters, one-and-done churners, feature-triggered
streaks, fading accounts — are visible in a way no aggregate DAU chart can show.

## Run it

```sh
npm install
npm run dev
```

Opens with a generated sample dataset (a fictional music app: plays, playlists,
shares, searches) so the visualization is immediately explorable.

## What's in the grid

- One row per user, one column per day; weekends shaded.
- The **symbol** in a cell is the day's *rarest* event — so low-frequency,
  high-signal moments (created a playlist) stay visible on days the core event
  also happened. Mark size steps up with event volume.
- A **ring** marks each user's first day (onboarding).
- Sort rows by signup date, active days, recency, or longest streak; filter by
  date range, platform, plan, or user search; toggle event types in the legend.
- Hover any cell for per-event counts; arrow keys navigate; click a row for the
  full per-user event log, attributes, and streak stats.
- **Cohort retention** curves (weekly signup cohorts, weeks fully elapsed only)
  ride below the grid, scoped to the same filters.

## Bring your own data

`Import CSV` accepts:

```csv
user_id,event,timestamp[,name,platform,plan,country]
u_001,processed_invoice,2026-07-01T14:03:22Z,Ada L.,Web,Pro,US
```

Timestamps may be ISO 8601 or epoch seconds/ms. Event types are ranked by
frequency: the top 4 get a slot + shape (the most frequent is treated as the
core event), the rest fold into "Other". `Export CSV` round-trips the current
dataset, sample data included — handy as a format reference.

## Roadmap

1. ✅ **Dot plot viewer** over imported/sample data (this phase).
2. **SDK + ingest** — tiny `track(userId, event, props)` client + endpoint, plus
   adapters for data people already have (Segment webhook, PostHog/Amplitude
   export, plain server logs).
3. **AI codebase scanner** — `npx dotchart scan` reads a repo, proposes a ranked
   value-event taxonomy, and generates the instrumentation diff.
4. **Pattern spotter & accounts** — AI annotations on the grid (churn-risk
   accounts, onboarding drop-off, feature→retention hunches), B2B seat
   activation view, renewal alerts.
