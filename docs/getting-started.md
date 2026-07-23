# Getting started

DotChart shows **every user as a row and every day as a column**, so you can
see individual usage patterns — streaks, churners, weekend-only users — that
no aggregate chart can show.

## Run it

**The easiest way:** if your team already runs a hosted DotChart, just
open it and sign up — your projects and data are yours alone, and the
login screen has a live demo you can explore before creating an account.

**Run your own** from a clone of the repo:

```sh
npm install
npm run dev        # development server on :5173
```

Everything — tracked events, saved projects — lives in `~/.dotchart` on
your machine. For an always-on team deployment with accounts, see
**Self-hosting**.

## First five minutes

1. **Load the demo** (Data ▾ → Load demo data) to learn the grid on a
   fictional music app — every feature works on it.
2. **Connect your project**: the Connect wizard analyzes your codebase (and,
   with your consent, your database) and proposes the events worth tracking.
   This step needs an AI — Claude (recommended), OpenAI, or a free local
   model via Ollama; the wizard walks you through the one-time choice.
3. **Show me my users**: events that already exist in your database chart
   immediately, with zero code changes.
4. **✨ Find patterns** asks Claude to point out churn risks, activation
   hypotheses, and users worth interviewing.

## What DotChart is not

It's not a general-purpose analytics warehouse. It's a sharp tool for one
question — *what are my users actually doing, one by one?* — plus an AI
scanner that figures out what's worth tracking so you don't start from a
blank page.
