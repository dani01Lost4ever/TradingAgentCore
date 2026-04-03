import Anthropic from '@anthropic-ai/sdk'
import axios from 'axios'
import { z } from 'zod'
import { AssetSnapshot, TokenUsageModel } from './schema'
import { Portfolio } from './poller'
import type { FearGreedData } from './sentiment'
import { computeAtrPositionSize } from './risk'
import { getConfig } from './config'

// ── Pricing table (USD per 1M tokens) ────────────────────────────────────────
// Update these if Anthropic changes pricing: https://www.anthropic.com/pricing
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-opus-4-20250514':    { input: 15.00, output: 75.00 },
  'claude-sonnet-4-20250514':  { input:  3.00, output: 15.00 },
  'claude-3-5-sonnet-20241022':{ input:  3.00, output: 15.00 },
  'claude-3-5-haiku-20241022': { input:  0.80, output:  4.00 },
  'claude-3-opus-20240229':    { input: 15.00, output: 75.00 },
}

function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 3.00, output: 15.00 }
  return (inputTokens / 1_000_000) * pricing.input
       + (outputTokens / 1_000_000) * pricing.output
}

async function saveTokenUsage(model: string, inputTokens: number, outputTokens: number, context = 'trade_decision') {
  try {
    const cost_usd = computeCost(model, inputTokens, outputTokens)
    await TokenUsageModel.create({ llm_model: model, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd, context })
  } catch (err) {
    console.warn('[brain] Failed to save token usage:', err)
  }
}

const DecisionSchema = z.object({
  action:     z.enum(['buy', 'sell', 'hold']),
  asset:      z.string(),
  amount_usd: z.number().min(0),
  confidence: z.number().min(0).max(1),
  reasoning:  z.string().min(10),
})

export type Decision = z.infer<typeof DecisionSchema>

const SYSTEM_PROMPT = `You are a crypto trading agent operating a paper trading account.
You receive a market snapshot with technical indicators for multiple assets and your current portfolio.
You must evaluate EVERY listed asset independently and return one decision per asset.

Indicator guide:
- RSI(14): >70 overbought (consider sell/hold), <30 oversold (consider buy), 40-60 neutral
- EMA9 vs EMA21: EMA9 > EMA21 = bullish short-term trend, EMA9 < EMA21 = bearish
- MACD hist: positive & rising = bullish momentum, negative & falling = bearish momentum
- BB %B: >1.0 above upper band (overbought), <0.0 below lower band (oversold), ~0.5 neutral
- ATR(14): higher = more volatile; prefer smaller positions in high-ATR environments
- Vol/SMA20: >1.5 = volume confirms the move; <0.5 = weak move
- Price vs daily SMA50: above = macro uptrend, below = macro downtrend
- 7d change: broader context beyond 24h

Sentiment guide:
- Fear & Greed 0-25: Extreme Fear — contrarian buy signal in oversold conditions
- Fear & Greed 25-45: Fear — cautious, look for quality setups
- Fear & Greed 55-75: Greed — reduce size, tighten stops
- Fear & Greed 75-100: Extreme Greed — avoid buying, watch for reversals
- Market Regime: adjust position sizing and risk tolerance to match regime

Rules:
- Never risk more than MAX_POSITION_USD per trade (use ATR-adjusted suggested sizes)
- Prefer hold when signals are mixed or ambiguous
- Do NOT favour cheap assets — confidence and signal quality matter, not price
- Diversify: avoid concentrating all activity on a single asset cycle after cycle
- Reference the specific indicators that drove your decision in the reasoning
- Use recent news as a sentiment signal but do not trade on news alone

Respond ONLY with a valid JSON array — one object per asset, in the same order as listed.
No extra text, no markdown fences. Pure JSON array only.
Keep reasoning to ONE short sentence (max 15 words) — brevity is required.

[
  { "action": "buy"|"sell"|"hold", "asset": "BTC/USD", "amount_usd": 0, "confidence": 0.0, "reasoning": "..." },
  ...
]`

function buildUserPrompt(
  market: Record<string, AssetSnapshot>,
  portfolio: Portfolio,
  maxPositionUsd: number,
  recentAssets: string[],
  fearGreed: FearGreedData | null,
  news: Record<string, string[]>,
  regime: string,
): string {
  const marketLines = Object.entries(market)
    .map(([asset, s]) => {
      const trend = s.ema_9 != null && s.ema_21 != null
        ? (s.ema_9 > s.ema_21 ? 'bullish' : 'bearish')
        : 'unknown'
      const volRatio = s.volume_sma20 && s.volume_sma20 > 0
        ? (s.volume_24h / 24 / s.volume_sma20).toFixed(2)
        : 'N/A'
      const sma50gap = s.daily_sma50
        ? `${((s.price - s.daily_sma50) / s.daily_sma50 * 100).toFixed(1)}%`
        : 'N/A'
      const atrSize = computeAtrPositionSize(s.atr_14, s.price, maxPositionUsd)

      const lines = [
        `${asset}:`,
        `  Price: $${s.price.toLocaleString()}  |  24h: ${s.change_24h}%  |  7d: ${s.change_7d ?? 'N/A'}%`,
        `  RSI(14): ${s.rsi_14 ?? 'N/A'}  |  EMA9: $${s.ema_9?.toLocaleString() ?? 'N/A'}  |  EMA21: $${s.ema_21?.toLocaleString() ?? 'N/A'}  |  Trend: ${trend}`,
        `  MACD: ${s.macd ?? 'N/A'}  |  Signal: ${s.macd_signal ?? 'N/A'}  |  Hist: ${s.macd_hist ?? 'N/A'}`,
        `  BB upper: $${s.bb_upper?.toLocaleString() ?? 'N/A'}  |  BB lower: $${s.bb_lower?.toLocaleString() ?? 'N/A'}  |  BB %B: ${s.bb_pct ?? 'N/A'}`,
        `  ATR(14): $${s.atr_14 ?? 'N/A'}  |  Vol/SMA20: ${volRatio}x  |  24h High: $${s.high_24h.toLocaleString()}  |  24h Low: $${s.low_24h.toLocaleString()}`,
        `  Daily SMA50: $${s.daily_sma50?.toLocaleString() ?? 'N/A'}  (price ${sma50gap} vs SMA50)`,
        `  Suggested size: $${atrSize} (ATR-adjusted)`,
      ]

      const assetNews = news[asset]
      if (assetNews && assetNews.length > 0) {
        lines.push(`  Recent news: ${assetNews.map(h => `"${h}"`).join(', ')}`)
      }

      return lines.join('\n')
    })
    .join('\n\n')

  const posLines = Object.entries(portfolio.positions)
    .map(([asset, qty]) => `  ${asset}: ${qty}`)
    .join('\n') || '  (none)'

  const recentNote = recentAssets.length
    ? `\nRECENTLY TRADED (last 3 cycles): ${recentAssets.join(', ')} — consider other assets if signals are equal.`
    : ''

  return `MACRO CONTEXT:
  Market Regime: ${regime}
  Fear & Greed: ${fearGreed ? `${fearGreed.value}/100 (${fearGreed.classification})` : 'N/A'}

MARKET SNAPSHOT (${new Date().toISOString()}):
${marketLines}

PORTFOLIO:
  Cash: $${portfolio.cash_usd.toFixed(2)}
  Equity: $${portfolio.equity_usd.toFixed(2)}
  Positions:
${posLines}

MAX TRADE SIZE: $${maxPositionUsd}${recentNote}

Evaluate every asset above and return one decision per asset as a JSON array.`
}

async function callClaude(userPrompt: string): Promise<string> {
  const model = getConfig().claudeModel || 'claude-3-5-haiku-20241022'
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    system:     SYSTEM_PROMPT,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  // Fire-and-forget token usage recording
  const { input_tokens, output_tokens } = msg.usage
  console.log(`[brain] Tokens — in: ${input_tokens}  out: ${output_tokens}  cost: $${computeCost(model, input_tokens, output_tokens).toFixed(4)}`)
  saveTokenUsage(model, input_tokens, output_tokens)

  const block = msg.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return block.text
}

async function callOllama(userPrompt: string): Promise<string> {
  const res = await axios.post(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
    model:   process.env.OLLAMA_MODEL || 'trading-llm',
    stream:  false,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user',   content: userPrompt },
    ],
  })
  return res.data.message.content
}

export async function getDecisions(
  market: Record<string, AssetSnapshot>,
  portfolio: Portfolio,
  maxPositionUsd: number,
  recentAssets: string[] = [],
  fearGreed: FearGreedData | null = null,
  news: Record<string, string[]> = {},
  regime = 'Unknown',
): Promise<Decision[]> {
  const assetList   = Object.keys(market)
  const userPrompt  = buildUserPrompt(market, portfolio, maxPositionUsd, recentAssets, fearGreed, news, regime)
  const provider    = process.env.LLM_PROVIDER || 'claude'

  console.log(`[brain] Calling ${provider} for ${assetList.length} assets...`)
  const raw = provider === 'ollama'
    ? await callOllama(userPrompt)
    : await callClaude(userPrompt)

  const cleaned = raw.replace(/```json|```/g, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    // Response may be truncated — salvage all complete JSON objects from the array
    const recovered = cleaned.replace(/,?\s*\{[^}]*$/, '').replace(/^\[/, '').trim()
    try {
      parsed = JSON.parse(`[${recovered}]`)
      console.warn(`[brain] Response was truncated — recovered ${(parsed as any[]).length} complete decisions. Consider raising max_tokens.`)
    } catch {
      throw new Error(`[brain] LLM returned invalid JSON (truncated and unrecoverable):\n${raw.slice(0, 300)}`)
    }
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`[brain] Expected JSON array, got: ${typeof parsed}`)
  }

  const decisions: Decision[] = []
  for (const item of parsed) {
    const result = DecisionSchema.safeParse(item)
    if (!result.success) {
      console.warn(`[brain] Skipping invalid decision for ${item?.asset}: ${result.error.message}`)
      continue
    }
    // Ensure asset is one we actually requested
    if (!assetList.includes(result.data.asset)) {
      console.warn(`[brain] Skipping unknown asset in response: ${result.data.asset}`)
      continue
    }
    result.data.amount_usd = Math.min(result.data.amount_usd, maxPositionUsd)
    decisions.push(result.data)
  }

  return decisions
}
