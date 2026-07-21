// DotChart pattern spotter: given compact per-user usage summaries, ask
// Claude to do the "humans staring at the fraud wall" job — surface the
// handful of patterns a founder should actually act on.

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'
import { ALLOWED_MODELS, DEFAULT_MODEL } from './scan.mjs'

function loadEnvKey() {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY
  const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  try {
    const m = fs.readFileSync(path.join(projectRoot, '.env'), 'utf8').match(/^ANTHROPIC_API_KEY=(.+)$/m)
    if (m) return m[1].trim()
  } catch {
    /* no .env */
  }
  return null
}

const INSIGHTS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['insights'],
  properties: {
    insights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'detail', 'kind', 'user_ids'],
        properties: {
          title: { type: 'string', description: 'Short, specific headline (max ~10 words)' },
          detail: {
            type: 'string',
            description: 'Two or three sentences with concrete numbers and what to do about it',
          },
          kind: { type: 'string', enum: ['churn_risk', 'activation', 'pattern', 'milestone'] },
          user_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'IDs of the specific users this insight is about (empty if it is about everyone)',
          },
        },
      },
    },
  },
}

const SYSTEM = `You are DotChart's pattern spotter. You receive a compact summary of per-user, per-day product usage (the same data shown on a dot-plot grid: one row per user, one column per day). Your job is what PayPal's fraud team did by staring at transaction walls: notice the handful of patterns a founder should actually act on.

Rules:
- 3 to 5 insights, ranked most actionable first. Fewer, sharper insights beat a list of observations.
- Be concrete: name counts, streaks, dates, and specific user ids (put them in user_ids so the UI can highlight those rows).
- Look for: users going quiet after being regular (churn risk, most valuable insight), behaviors that precede strong retention (activation hypotheses), weekday/weekend or cadence clusters, one-and-done onboarding failures, power users worth talking to.
- 'recent' is a 28-character string, oldest→newest, 1 = active that day.
- Do NOT restate totals the dashboard already shows (user count, event count). Find what a human staring at the grid for an hour would circle.`

export async function findInsights(summary, { model, apiKey: userKey } = {}) {
  const MODEL = ALLOWED_MODELS.includes(model) ? model : DEFAULT_MODEL
  const apiKey = userKey || loadEnvKey()
  if (!apiKey) throw new Error('No API key — add yours in Settings, or put ANTHROPIC_API_KEY in the project .env')

  const client = new Anthropic({ apiKey })
  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: 'adaptive' },
    system: SYSTEM,
    output_config: { format: { type: 'json_schema', schema: INSIGHTS_SCHEMA } },
    messages: [{ role: 'user', content: JSON.stringify(summary) }],
  })
  const message = await stream.finalMessage()
  if (message.stop_reason === 'refusal') throw new Error('Model declined the request')
  const out = JSON.parse(message.content.filter((b) => b.type === 'text').map((b) => b.text).join(''))
  return {
    insights: out.insights.slice(0, 5),
    meta: { model: MODEL, usage: { input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens } },
  }
}
