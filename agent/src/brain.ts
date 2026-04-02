import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import { z } from 'zod'
import { AssetSnapshot } from './schema'
import { Portfolio } from './poller'

// Zod schema for validating LLM output
const DecisionSchema = z.object({
  action: z.enum(['buy', 'sell', 'hold']),
  asset: z.string(),
  amount_usd: z.number().min(0),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(10),
})

export type Decision = z.infer<typeof DecisionSchema>

const SYSTEM_PROMPT = `You are a crypto trading agent operating a paper trading account.
You receive a market snapshot and current portfolio, then decide whether to buy, sell, or hold.

Rules:
- Never risk more than the MAX_POSITION_USD limit per trade
- Prefer hold when signals are ambiguous
- Always justify your decision with clear, concise reasoning

Respond ONLY with a valid JSON object matching this exact shape:
{
  "action": "buy" | "sell" | "hold",
  "asset": "BTC/USD",
  "amount_usd": 0,
  "confidence": 0.0,
  "reasoning": "..."
}

No extra text, no markdown fences. Pure JSON only.`

function buildUserPrompt(
  market: Record<string, AssetSnapshot>,
  portfolio: Portfolio,
  maxPositionUsd: number
): string {
  const marketLines = Object.entries(market)
    .map(([asset, s]) =>
      `${asset}: price=$${s.price.toLocaleString()}, 24h=${s.change_24h}%, ` +
      `RSI=${s.rsi_14 ?? 'N/A'}, high=$${s.high_24h.toLocaleString()}, low=$${s.low_24h.toLocaleString()}`
    )
    .join('\n')

  const posLines = Object.entries(portfolio.positions)
    .map(([asset, qty]) => `  ${asset}: ${qty}`)
    .join('\n') || '  (none)'

  return `MARKET SNAPSHOT (${new Date().toISOString()}):
${marketLines}

PORTFOLIO:
  Cash: $${portfolio.cash_usd.toFixed(2)}
  Equity: $${portfolio.equity_usd.toFixed(2)}
  Positions:
${posLines}

MAX TRADE SIZE: $${maxPositionUsd}

Make a trading decision now.`
}

async function callClaude(userPrompt: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = msg.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return block.text
}

async function callOllama(userPrompt: string): Promise<string> {
  const res = await axios.post(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
    model: process.env.OLLAMA_MODEL || 'trading-llm',
    stream: false,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
  })
  return res.data.message.content
}

export async function getDecision(
  market: Record<string, AssetSnapshot>,
  portfolio: Portfolio,
  maxPositionUsd: number
): Promise<Decision> {
  const userPrompt = buildUserPrompt(market, portfolio, maxPositionUsd)
  const provider = process.env.LLM_PROVIDER || 'claude'

  console.log(`[brain] Calling ${provider}...`)
  const raw = provider === 'ollama'
    ? await callOllama(userPrompt)
    : await callClaude(userPrompt)

  // Strip any accidental markdown fences
  const cleaned = raw.replace(/```json|```/g, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    throw new Error(`[brain] LLM returned invalid JSON:\n${raw}`)
  }

  const result = DecisionSchema.safeParse(parsed)
  if (!result.success) {
    throw new Error(`[brain] Decision failed Zod validation: ${result.error.message}`)
  }

  // Clamp amount to max position
  result.data.amount_usd = Math.min(result.data.amount_usd, maxPositionUsd)

  return result.data
}
