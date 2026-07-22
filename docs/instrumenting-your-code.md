# Instrumenting your code

Events labeled **needs a one-line code change** in your plan don't exist in
your database yet. DotChart writes the tracking code for you — on a git
branch, never on your working tree.

## How it works

1. **Propose** — Claude drafts minimal, additive edits: a `track()` call at
   each success point, an import per file, and a tiny `dotchart.js`/`.ts`
   client matched to your repo's style (TypeScript/ESM/CJS). Every edit is
   validated against the file on disk before you see it.
2. **Review** — each edit is shown as a diff with a checkbox. Reject
   anything you don't like.
3. **Apply** — approved edits are committed to a new `dotchart/…` branch.
   Your current branch and working tree are left exactly as they were (it
   refuses to run on a dirty tree).

Review with `git diff main...dotchart/<branch>`, merge when happy, or just
delete the branch to throw everything away.

## The generated client

The `dotchart` client is a no-op until you set an environment variable in
the instrumented app:

```sh
DOTCHART_INGEST_URL=http://localhost:5300/ingest
```

(Your actual ingest URL is shown in the app; for a hosted DotChart it's
`https://your-dotchart-host/ingest`.) So you can merge the branch safely —
nothing is sent anywhere until you opt in with that variable.

Once set, every tracked action lands on your grid within ~15 seconds — see
**Live tracking**.
