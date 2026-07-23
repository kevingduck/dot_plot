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

## On a hosted DotChart

Projects connected **via GitHub** get the same flow, ending in a push: after
you approve the edits, paste a GitHub token with write access to the repo
(used once for the push, never stored) — DotChart pushes the `dotchart/*`
branch and hands you the pull-request link to review and merge.

Projects connected with the **browser folder picker** can't be edited by
the server (it never had the files): reconnect the project from GitHub for
the one-click flow above, or copy each event's snippet from the plan's
"Where" column by hand.

## The generated client

**Identity is handled for you.** Where your code has a user id in scope,
the tracking call uses it. Where it doesn't, the call passes `null` and
the client resolves identity itself: in the browser every visitor gets a
stable anonymous id (its own row on the grid), upgraded to the real user
the moment your app calls `dotchart.identify(user.id)` at login — the
proposal adds that call for you when a login point is in the scanned
files. Server-side calls with no identity are dropped rather than
mis-attributed.

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
