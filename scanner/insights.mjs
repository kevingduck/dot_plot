// DotChart pattern spotter: given compact per-user usage summaries, ask
// Claude to do the "humans staring at the fraud wall" job — surface the
// handful of patterns a founder should actually act on.

import { resolveAi, runStructured } from './llm.mjs'

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

/** The LLM request for an insights run — also used by the browser-Ollama path. */
export function buildInsightsRequest(summary) {
  return { system: SYSTEM, prompt: JSON.stringify(summary), schema: INSIGHTS_SCHEMA, maxTokens: 8000 }
}

/** Shape any provider's raw output into the API response. */
export function finishInsights(out, { model, provider, usage } = {}) {
  if (!out || !Array.isArray(out.insights)) throw new Error('The model did not return insights')
  return { insights: out.insights.slice(0, 5), meta: { model, provider, usage } }
}

export async function findInsights(summary, { model, apiKey, provider, baseUrl, allowEnvKey } = {}) {
  const ai = resolveAi({ provider, model, apiKey, baseUrl, allowEnvKey })
  const { object, usage } = await runStructured(ai, buildInsightsRequest(summary))
  return finishInsights(object, { model: ai.model, provider: ai.provider, usage })
}
