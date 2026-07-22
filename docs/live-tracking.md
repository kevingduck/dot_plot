# Live tracking

DotChart has a built-in ingest endpoint: `POST /ingest` on the same host as
the app (CORS-open, batched, validated, capped). Instrumented apps send
events there and the grid updates within ~15 seconds — the **● N tracked
events** chip in the status bar shows the feed.

## Point your app at it

If you used DotChart's instrumentation flow, set one environment variable
in your app:

```sh
DOTCHART_INGEST_URL=http://localhost:5300/ingest   # or your hosted URL
```

Without it the generated client is a no-op, so it's always safe to deploy.

## Send events yourself

The endpoint accepts a single event or a batch:

```sh
curl -X POST http://localhost:5300/ingest \
  -H 'content-type: application/json' \
  -d '{"events": [{"user_id": "u_42", "event": "created_report", "ts": 1753142400000}]}'
```

Each event needs a `user_id`, an `event` name, and a `ts` timestamp
(epoch ms, epoch seconds, or ISO 8601). Events are stored in
`~/.dotchart/events.jsonl` on the DotChart host and merge into whatever
project is on the grid.

**Device info comes free:** when events are sent from the user's browser,
DotChart classifies the request's User-Agent into OS · browser · device
class and uses it as the user's platform (filterable above the grid).
Events sent from your backend can't reveal the end user's device — include
`os`, `browser`, or `device` fields in the event payload if you want them
there too.

## Database projects

If your events already live in your database you may not need ingest at
all — **↻ Refresh data** in the status bar re-imports (read-only) with your
approved table mappings.
