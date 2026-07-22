# CSV import & export

No code, no database — a CSV is enough to light up the grid. Use
**Data ▾ → Import events CSV** (or the wizard's "Other ways to add data").

## Format

```csv
user_id,event,timestamp[,name,platform,plan,country]
u_001,processed_invoice,2026-07-01T14:03:22Z,Ada L.,Web,Pro,US
u_002,processed_invoice,1751378602,,iOS,Free,DE
```

- **user_id** — any stable identifier.
- **event** — the event name; snake_case reads best in the legend.
- **timestamp** — ISO 8601, epoch seconds, or epoch milliseconds.
- **name, platform, plan, country** — optional; they power the filters and
  the user drawer.

Only the header order shown above matters for the optional columns; extra
whitespace is fine.

## How events become the legend

Event types are ranked by frequency: the top 4 get a symbol and color (the
most frequent is treated as the core event) and the rest fold into
"Other". If you have an event plan loaded, the plan's labels and core
choice win instead.

## Export

**Data ▾ → Export current data as CSV** round-trips whatever is on the
grid — including the demo data, which makes it a handy format reference.
