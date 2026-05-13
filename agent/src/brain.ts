import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import axios from 'axios'
import { z } from 'zod'
import { AssetSnapshot, TokenUsageModel } from './schema'
import { Portfolio } from './poller'
import type { FearGreedData } from './sentiment'
import { computeAtrPositionSize } from './risk'
import { getConfig, type AgentConfig } from './config'
import { getKey } from './keys'
import { shouldTradeNet, type FeeModel } from './costs'

// â”€â”€ Pricing table (USD per 1M tokens) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic
  'claude-opus-4-20250514':    { input: 15.00, output: 75.00 },
  'claude-sonnet-4-20250514':  { input:  3.00, output: 15.00 },
  'claude-3-5-sonnet-20241022':{ input:  3.00, output: 15.00 },
  'claude-haiku-4-5-20251001': { input:  0.80, output:  4.00 },
  'claude-3-5-haiku-20241022': { input:  0.80, output:  4.00 },
  'claude-3-opus-20240229':    { input: 15.00, output: 75.00 },
  // OpenAI
  'babbage-002':                { input:  0.40, output:  1.60 },
  'chatgpt-4o-latest':          { input:  5.00, output: 15.00 },
  'codex-mini-latest':          { input:  1.50, output:  6.00 },
  'computer-use-preview':       { input:  3.00, output: 12.00 },
  'davinci-002':                { input:  2.00, output:  8.00 },
  'gpt-3.5-turbo':              { input:  0.50, output:  1.50 },
  'gpt-3.5-turbo-instruct':     { input:  1.50, output:  2.00 },
  'gpt-4':                      { input: 30.00, output: 60.00 },
  'gpt-4-turbo':                { input: 10.00, output: 30.00 },
  'gpt-4-turbo-preview':        { input: 10.00, output: 30.00 },
  'gpt-4.1':                    { input:  2.00, output:  8.00 },
  'gpt-4.1-mini':               { input:  0.40, output:  1.60 },
  'gpt-4.1-nano':               { input:  0.10, output:  0.40 },
  'gpt-4.5-preview':            { input: 75.00, output: 150.00 },
  'gpt-4o':                     { input:  2.50, output: 10.00 },
  'gpt-4o-mini':                { input:  0.15, output:  0.60 },
  'gpt-4o-mini-search-preview': { input:  0.15, output:  0.60 },
  'gpt-4o-search-preview':      { input:  2.50, output: 10.00 },
  'gpt-5':                      { input:  1.25, output: 10.00 },
  'gpt-5-codex':                { input:  1.25, output: 10.00 },
  'gpt-5-chat':                 { input:  1.25, output: 10.00 },
  'gpt-5-mini':                 { input:  0.25, output:  2.00 },
  'gpt-5-nano':                 { input:  0.05, output:  0.40 },
  'gpt-5-pro':                  { input: 15.00, output: 120.00 },
  'gpt-5.1-chat':               { input:  1.25, output: 10.00 },
  'gpt-5.1-codex':              { input:  1.25, output: 10.00 },
  'gpt-5.1-codex-max':          { input:  1.25, output: 10.00 },
  'gpt-5.1-codex-mini':         { input:  0.25, output:  2.00 },
  'gpt-5.2':                    { input:  1.75, output: 14.00 },
  'gpt-5.2-codex':              { input:  1.75, output: 14.00 },
  'gpt-5.2-chat':               { input:  1.75, output: 14.00 },
  'gpt-5.2-pro':                { input: 21.00, output: 168.00 },
  'gpt-5.3-chat':               { input:  1.75, output: 14.00 },
  'gpt-5.3-codex':              { input:  1.75, output: 14.00 },
  'gpt-5.4':                    { input:  2.50, output: 15.00 },
  'gpt-5.4-mini':               { input:  0.75, output:  4.50 },
  'gpt-5.4-nano':               { input:  0.20, output:  1.25 },
  'gpt-5.4-pro':                { input: 30.00, output: 180.00 },
  'o1':                         { input: 15.00, output: 60.00 },
  'o1-mini':                    { input:  1.10, output:  4.40 },
  'o1-pro':                     { input: 150.00, output: 600.00 },
  'o1-preview':                 { input: 15.00, output: 60.00 },
  'o3':                         { input:  1.00, output:  4.00 },
  'o3-deep-research':           { input: 10.00, output: 40.00 },
  'o3-mini':                    { input:  1.10, output:  4.40 },
  'o3-pro':                     { input: 20.00, output: 80.00 },
  'o4-mini':                    { input:  1.10, output:  4.40 },
  'o4-mini-deep-research':      { input:  2.00, output:  8.00 },
}

function computeCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? { input: 3.00, output: 15.00 }
  return (inputTokens / 1_000_000) * pricing.input
       + (outputTokens / 1_000_000) * pricing.output
}

async function saveTokenUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  userId = '__global__',
  walletId?: string,
  context = 'trade_decision'
) {
  try {
    const cost_usd = computeCost(model, inputTokens, outputTokens)
    await TokenUsageModel.create({ userId, walletId, llm_model: model, input_tokens: inputTokens, output_tokens: outputTokens, cost_usd, context })
  } catch (err) {
    console.warn('[brain] Failed to save token usage:', err)
  }
}

/** Returns true for OpenAI model IDs */
function isOpenAIModel(model: string): boolean {
  return model.startsWith('gpt-')
      || model.startsWith('o1')
      || model.startsWith('o3')
      || model.startsWith('o4')
      || model.startsWith('chatgpt-')
      || model.startsWith('codex-')
      || model === 'computer-use-preview'
      || model === 'davinci-002'
      || model === 'babbage-002'
}

// â”€â”€ Known valid Claude models â€” used to warn about unknown IDs â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const KNOWN_CLAUDE_MODELS = new Set(Object.keys(MODEL_PRICING).filter(k => k.startsWith('claude')))
const DEFAULT_ESTIMATED_INPUT_TOKENS = 3400
const DEFAULT_ESTIMATED_OUTPUT_TOKENS = 350

const DecisionSchema = z.object({
  action:     z.enum(['buy', 'sell', 'hold']),
  asset:      z.string(),
  amount_usd: z.number().min(0),
  confidence: z.number().min(0).max(1),
  reasoning:  z.string().min(10),
})

export type Decision = z.infer<typeof DecisionSchema>

interface CostContext {
  recentAvgCallCostUsd: number
  consensusAvgCallCostUsd: number
  estimatedTotalCostUsd: number
  requiredProfitUsd: number
  sampleSize: number
}

export interface DecisionRuntimeContext {
  userId?: string
  walletId?: string
  config?: AgentConfig
  keys?: {
    anthropic_api_key?: string
    openai_api_key?: string
  }
  /** Wallet-level cost parameters (broker fees + tax) */
  costConfig?: {
    feeModel: FeeModel
    taxRatePct: number
    minNetProfitPct: number
  }
}

const SYSTEM_PROMPT = `You are a trading agent operating a paper account that can trade BOTH cryptocurrencies and US equities/ETFs.
You receive a market snapshot with technical indicators for multiple assets and your current portfolio.
You must evaluate EVERY listed asset independently and return one decision per asset.

ASSET CLASS DETECTION:
- Symbol contains "/" (e.g. "BTC/USD", "ETH/USD") â†’ cryptocurrency, 24/7 market.
- Symbol without "/" (e.g. "AAPL", "SPY", "MCD") â†’ US equity or ETF, regular market hours.
The same technical indicators below apply to both classes.

Indicator guide:
- RSI(14): >70 overbought (consider sell/hold), <30 oversold (consider buy), 40-60 neutral
- EMA9 vs EMA21: EMA9 > EMA21 = bullish short-term trend, EMA9 < EMA21 = bearish
- MACD hist: positive & rising = bullish momentum, negative & falling = bearish momentum
- BB %B: >1.0 above upper band (overbought), <0.0 below lower band (oversold), ~0.5 neutral
- ATR(14): higher = more volatile; prefer smaller positions in high-ATR environments
- Vol/SMA20: >1.5 = volume confirms the move; <0.5 = weak move
- Price vs daily SMA50: above = macro uptrend, below = macro downtrend
- 7d change: broader context beyond 24h

Sentiment guide (most relevant for crypto):
- Fear & Greed 0-25: Extreme Fear â€” contrarian buy signal in oversold conditions
- Fear & Greed 25-45: Fear â€” cautious, look for quality setups
- Fear & Greed 55-75: Greed â€” reduce size, tighten stops
- Fear & Greed 75-100: Extreme Greed â€” avoid buying, watch for reversals
- Market Regime: adjust position sizing and risk tolerance to match regime

DECISION RULES (read carefully â€” this is the most important section):
- TAKE A POSITION when signals lean clearly bullish or bearish. You do NOT need every indicator to align. A two-indicator setup (e.g. RSI 50-65 AND EMA9>EMA21 AND price>SMA50) is enough for a BUY at moderate confidence (0.5-0.65). Three aligned indicators justifies high confidence (0.7-0.85).
- HOLD only when signals are genuinely mixed (e.g. neutral RSI + flat EMAs + flat MACD) or contradictory (e.g. bullish trend but extreme overbought RSI). Do not hold by default â€” you must justify a hold as much as a trade.
- Express your conviction honestly via the confidence field. 0.4-0.5 is acceptable for moderate-conviction trades. Do NOT return confidence: 0 unless you genuinely have no view at all. The user has a confidence threshold that filters out weak signals automatically; you do not need to self-gate.
- Never risk more than MAX_POSITION_USD per trade (use ATR-adjusted suggested sizes).
- Do NOT favour cheap assets â€” confidence and signal quality matter, not price.
- Diversify: avoid concentrating all activity on a single asset cycle after cycle.
- Consider capital rotation: sell weaker held assets to buy stronger unheld assets.
- For strong exit signals on held assets, you may set amount_usd to full position value.
- Account for round-trip broker fees + tax shown in the prompt. Reject trades whose expected gross move is smaller than the cost floor, but otherwise act.
- Reference 2-3 SPECIFIC indicator values in your reasoning (e.g. "RSI 58, EMA9>EMA21, +2% vs SMA50").
- Use recent news as a sentiment signal but do not trade on news alone.

Respond ONLY with a valid JSON array â€” one object per asset, in the same order as listed.
No extra text, no markdown fences. Pure JSON array only.
Keep reasoning to ONE short sentence (max 15 words) â€” brevity is required.

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
  costContext: CostContext | null,
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
    ? `\nRECENTLY TRADED (last 3 cycles): ${recentAssets.join(', ')} â€” consider other assets if signals are equal.`
    : ''
  const costNote = costContext
    ? `\nCOST DISCIPLINE:
  Recent avg LLM call cost (${costContext.sampleSize || 0} sample${costContext.sampleSize === 1 ? '' : 's'}): $${costContext.recentAvgCallCostUsd.toFixed(4)}
  ${costContext.consensusAvgCallCostUsd > 0 ? `Consensus avg call cost: $${costContext.consensusAvgCallCostUsd.toFixed(4)}\n  ` : ''}Estimated total LLM cost this cycle: $${costContext.estimatedTotalCostUsd.toFixed(4)}
  Minimum expected gross profit required before trading: $${costContext.requiredProfitUsd.toFixed(4)}
  Return HOLD when the setup is too small to justify that cost.`
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

MAX TRADE SIZE: $${maxPositionUsd}${recentNote}${costNote}

Evaluate every asset above and return one decision per asset as a JSON array.`
}

async function getAverageRecentCost(model: string, lookback: number, userId = '__global__', walletId?: string): Promise<{ avgCostUsd: number; sampleSize: number }> {
  if (lookback <= 0) {
    return {
      avgCostUsd: computeCost(model, DEFAULT_ESTIMATED_INPUT_TOKENS, DEFAULT_ESTIMATED_OUTPUT_TOKENS),
      sampleSize: 0,
    }
  }

  const scope: Record<string, any> = { userId, llm_model: model }
  if (walletId) scope.walletId = walletId

  const rows = await TokenUsageModel.find(scope)
    .sort({ ts: -1 })
    .limit(lookback)
    .lean()

  if (!rows.length) {
    return {
      avgCostUsd: computeCost(model, DEFAULT_ESTIMATED_INPUT_TOKENS, DEFAULT_ESTIMATED_OUTPUT_TOKENS),
      sampleSize: 0,
    }
  }

  const totalCostUsd = rows.reduce((sum, row) => sum + (row.cost_usd ?? 0), 0)
  return {
    avgCostUsd: totalCostUsd / rows.length,
    sampleSize: rows.length,
  }
}

async function buildCostContext(
  primaryModel: string,
  consensusModel: string | null,
  cfg: AgentConfig,
  userId = '__global__',
  walletId?: string
): Promise<CostContext | null> {
  if (!cfg.costAwareTrading) return null

  const lookback = Math.max(1, Math.floor(cfg.costLookbackCalls || 20))
  const primary = await getAverageRecentCost(primaryModel, lookback, userId, walletId)
  const consensus = consensusModel
    ? await getAverageRecentCost(consensusModel, lookback, userId, walletId)
    : { avgCostUsd: 0, sampleSize: 0 }

  const estimatedTotalCostUsd = primary.avgCostUsd + consensus.avgCostUsd
  return {
    recentAvgCallCostUsd: primary.avgCostUsd,
    consensusAvgCallCostUsd: consensus.avgCostUsd,
    estimatedTotalCostUsd,
    requiredProfitUsd: estimatedTotalCostUsd * Math.max(cfg.costProfitRatio || 0, 0),
    sampleSize: primary.sampleSize,
  }
}

function estimateExpectedGrossProfitUsd(decision: Decision, cfg: AgentConfig): number {
  if (decision.action === 'hold' || decision.amount_usd <= 0) return 0

  const takeProfitPct = Math.max(cfg.takeProfitPct, 0)
  const stopLossPct = Math.max(cfg.stopLossPct, 0)
  const confidence = Math.max(0, Math.min(1, decision.confidence))
  const expectedMovePct = confidence * takeProfitPct - (1 - confidence) * stopLossPct

  return Math.max(0, decision.amount_usd * (expectedMovePct / 100))
}

function applyCostGuardrails(decisions: Decision[], costContext: CostContext | null, cfg: AgentConfig): Decision[] {
  if (!costContext) return decisions

  return decisions.map(decision => {
    if (decision.action === 'hold') return decision

    const expectedGrossProfitUsd = estimateExpectedGrossProfitUsd(decision, cfg)
    if (expectedGrossProfitUsd >= costContext.requiredProfitUsd) return decision

    return {
      ...decision,
      action: 'hold',
      amount_usd: 0,
      reasoning: `Expected edge $${expectedGrossProfitUsd.toFixed(2)} below LLM cost floor $${costContext.requiredProfitUsd.toFixed(2)}`,
    }
  })
}

/**
 * Broker-fee + tax guardrail.
 *
 * expectedReturnPct derivation (heuristic, documented here):
 *   We use `decision.confidence * baselineMovePct` where baselineMovePct = 1.0%.
 *   Rationale: 1% is a conservative round-number estimate of the typical gross move
 *   that a confident LLM signal targets (crypto scalp targets ~1–2%). Multiplying by
 *   confidence (0–1) scales it down for weaker signals. We intentionally choose a LOW
 *   baseline so that marginal signals are still caught by the fee filter. For example,
 *   a 60%-confidence signal implies 0.6% gross expected return; after 0.6% round-trip
 *   fees and 26% Italian CGT, the net is negative — correctly flagged.
 */
export function applyBrokerTaxGuardrails(
  decisions: Decision[],
  costConfig: DecisionRuntimeContext['costConfig'],
): Decision[] {
  if (!costConfig) return decisions
  const { feeModel, taxRatePct, minNetProfitPct } = costConfig
  const BASELINE_MOVE_PCT = 1.0

  return decisions.map(decision => {
    if (decision.action === 'hold' || decision.amount_usd <= 0) return decision

    const expectedReturnPct = decision.confidence * BASELINE_MOVE_PCT

    const result = shouldTradeNet({
      notional: decision.amount_usd,
      expectedReturnPct,
      feeModel,
      taxRatePct,
      minNetProfitPct,
    })

    if (!result.ok) {
      return {
        ...decision,
        action: 'hold' as const,
        amount_usd: 0,
        reasoning: `[fee+tax filter] ${result.reason}`,
      }
    }

    return decision
  })
}

async function getSystemPrompt(_userId = '__global__'): Promise<string> {
  try {
    const { PromptModel } = await import('./schema')
    const doc = await PromptModel.findOne({ key: 'system_prompt' }).lean()
    return doc?.value || SYSTEM_PROMPT
  } catch { return SYSTEM_PROMPT }
}

async function buildSystemPromptForContext(ctx?: DecisionRuntimeContext): Promise<string> {
  const base = await getSystemPrompt(ctx?.userId)
  // Append mode-specific prompt hint if config carries one
  const cfg = ctx?.config as (import('./config').EffectiveConfig | undefined)
  let result = base
  if (cfg && 'tradingMode' in cfg) {
    const { tradingModeDefaults } = await import('./config')
    const modeDefaults = tradingModeDefaults[cfg.tradingMode]
    if (modeDefaults?.promptHint) {
      result = `${result}\n\nTRADING MODE (${cfg.tradingMode.toUpperCase()}): ${modeDefaults.promptHint}`
    }
  }
  // Append wallet cost parameters so the LLM avoids proposing microscopic trades
  if (ctx?.costConfig) {
    const { feeModel, taxRatePct, minNetProfitPct } = ctx.costConfig
    const feeDesc = feeModel.kind === 'percent'
      ? `${feeModel.value}%  (model: percent, minFee: $${feeModel.minFee})`
      : `$${feeModel.value} flat  (model: flat, minFee: $${feeModel.minFee})`
    result = `${result}\n\nTrading costs for this wallet:\n- Round-trip broker fee: ${feeDesc}\n- Capital gains tax on realized profit: ${taxRatePct}%\n- Minimum acceptable net profit: ${minNetProfitPct}%\nDo not propose trades whose expected net return is below the minimum.`
  }
  return result
}

async function callClaude(model: string, userPrompt: string, ctx?: DecisionRuntimeContext): Promise<string> {
  const apiKey = ctx?.keys?.anthropic_api_key || getKey('anthropic_api_key')
  if (!apiKey) throw new Error('[brain] Anthropic API key not set — add it in Settings')

  if (!KNOWN_CLAUDE_MODELS.has(model)) {
    console.warn(`[brain] Unknown Claude model “${model}” — attempting anyway`)
  }

  const systemPrompt = await buildSystemPromptForContext(ctx)

  const client = new Anthropic({ apiKey })
  const msg = await client.messages.create({
    model,
    max_tokens: 1024,
    system:     systemPrompt,
    messages:   [{ role: 'user', content: userPrompt }],
  })

  const { input_tokens, output_tokens } = msg.usage
  console.log(`[brain] Claude tokens â€” in: ${input_tokens}  out: ${output_tokens}  cost: $${computeCost(model, input_tokens, output_tokens).toFixed(4)}`)
  saveTokenUsage(model, input_tokens, output_tokens, ctx?.userId || '__global__', ctx?.walletId)

  const block = msg.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')
  return block.text
}

async function callOpenAI(model: string, userPrompt: string, ctx?: DecisionRuntimeContext): Promise<string> {
  const apiKey = ctx?.keys?.openai_api_key || getKey('openai_api_key')
  if (!apiKey) throw new Error('[brain] OpenAI API key not set — add it in Settings')

  const systemPrompt = await buildSystemPromptForContext(ctx)

  const client = new OpenAI({ apiKey })
  const response = await client.chat.completions.create({
    model,
    max_tokens: 1024,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  })

  const inputTokens  = response.usage?.prompt_tokens     ?? 0
  const outputTokens = response.usage?.completion_tokens ?? 0
  console.log(`[brain] OpenAI tokens â€” in: ${inputTokens}  out: ${outputTokens}  cost: $${computeCost(model, inputTokens, outputTokens).toFixed(4)}`)
  saveTokenUsage(model, inputTokens, outputTokens, ctx?.userId || '__global__', ctx?.walletId)

  return response.choices[0]?.message?.content ?? ''
}

async function callOllama(userPrompt: string, ctx?: DecisionRuntimeContext): Promise<string> {
  const systemPrompt = await buildSystemPromptForContext(ctx)
  const res = await axios.post(`${process.env.OLLAMA_BASE_URL}/api/chat`, {
    model:   process.env.OLLAMA_MODEL || 'trading-llm',
    stream:  false,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
  })
  return res.data.message.content
}

async function callLLM(model: string, userPrompt: string, ctx?: DecisionRuntimeContext): Promise<string> {
  const provider = isOpenAIModel(model) ? 'openai' : 'claude'
  return provider === 'openai' ? callOpenAI(model, userPrompt, ctx) : callClaude(model, userPrompt, ctx)
}

function parseDecisions(raw: string, assetList: string[], maxPositionUsd: number): Decision[] {
  const cleaned = raw.replace(/```json|```/g, '').trim()
  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const recovered = cleaned.replace(/,?\s*\{[^}]*$/, '').replace(/^\[/, '').trim()
    try {
      parsed = JSON.parse(`[${recovered}]`)
    } catch {
      return []
    }
  }
  if (!Array.isArray(parsed)) return []
  const decisions: Decision[] = []
  for (const item of parsed) {
    const result = DecisionSchema.safeParse(item)
    if (!result.success) continue
    if (!assetList.includes(result.data.asset)) continue
    result.data.amount_usd = Math.min(result.data.amount_usd, maxPositionUsd)
    decisions.push(result.data)
  }
  return decisions
}

export async function getDecisions(
  market: Record<string, AssetSnapshot>,
  portfolio: Portfolio,
  maxPositionUsd: number,
  recentAssets: string[] = [],
  fearGreed: FearGreedData | null = null,
  news: Record<string, string[]> = {},
  regime = 'Unknown',
  runtime?: DecisionRuntimeContext,
): Promise<Decision[]> {
  const assetList  = Object.keys(market)
  const cfg = runtime?.config || getConfig()
  const model      = cfg.claudeModel || 'claude-haiku-4-5-20251001'

  // Provider resolution: model name always wins (gpt-*/o1/o3 â†’ openai, claude-* â†’ claude).
  // LLM_PROVIDER=ollama still works as an explicit override; 'claude'/'openai' values are
  // ignored when the model name already makes the provider unambiguous.
  const envProvider = process.env.LLM_PROVIDER
  const provider = envProvider === 'ollama'   ? 'ollama'
                 : isOpenAIModel(model)        ? 'openai'
                 : model.startsWith('claude-') ? 'claude'
                 : envProvider === 'openai'    ? 'openai'
                 : 'claude'
  const costContext = provider === 'ollama'
    ? null
    : await buildCostContext(
      model,
      cfg.consensusMode && cfg.consensusModel ? cfg.consensusModel : null,
      cfg,
      runtime?.userId || '__global__',
      runtime?.walletId
    )
  const userPrompt = buildUserPrompt(market, portfolio, maxPositionUsd, recentAssets, fearGreed, news, regime, costContext)

  console.log(`[brain] Calling ${provider} (${model}) for ${assetList.length} assets...`)

  const raw = provider === 'ollama'  ? await callOllama(userPrompt, runtime)
            : provider === 'openai'  ? await callOpenAI(model, userPrompt, runtime)
            :                          await callClaude(model, userPrompt, runtime)

  const cleaned = raw.replace(/```json|```/g, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    const recovered = cleaned.replace(/,?\s*\{[^}]*$/, '').replace(/^\[/, '').trim()
    try {
      parsed = JSON.parse(`[${recovered}]`)
      console.warn(`[brain] Response was truncated â€” recovered ${(parsed as any[]).length} complete decisions.`)
    } catch {
      throw new Error(`[brain] LLM returned invalid JSON:\n${raw.slice(0, 300)}`)
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
    if (!assetList.includes(result.data.asset)) {
      console.warn(`[brain] Skipping unknown asset in response: ${result.data.asset}`)
      continue
    }
    result.data.amount_usd = Math.min(result.data.amount_usd, maxPositionUsd)
    decisions.push(result.data)
  }

  // Consensus mode: run a second model and merge decisions
  if (cfg.consensusMode && cfg.consensusModel) {
    console.log(`[brain] Consensus mode â€” calling ${cfg.consensusModel}`)
    try {
      const consensusRaw = await callLLM(cfg.consensusModel, userPrompt, runtime)
      const consensusDecisions = parseDecisions(consensusRaw, assetList, maxPositionUsd)

      const consensusMap = new Map(consensusDecisions.map(d => [d.asset, d]))
      for (const decision of decisions) {
        const consensus = consensusMap.get(decision.asset)
        if (!consensus) continue
        if (consensus.action !== decision.action) {
          console.log(`[brain] Consensus disagreement on ${decision.asset}: primary=${decision.action} consensus=${consensus.action} â€” setting to hold`)
          decision.action = 'hold'
          decision.amount_usd = 0
        }
      }
    } catch (err: any) {
      console.warn(`[brain] Consensus model call failed: ${err.message}`)
    }
  }

  const afterLlmCostGuard = applyCostGuardrails(decisions, costContext, cfg)
  return applyBrokerTaxGuardrails(afterLlmCostGuard, runtime?.costConfig)
}

import { registerLlmStrategy } from './strategies/registry'
import type { StrategyMeta, StrategyContext, StrategyResult, ResolvedParams } from './strategies/types'

export const llmStrategy: StrategyMeta = {
  id: 'llm',
  label: 'LLM (AI)',
  description: 'Claude or OpenAI evaluates all indicators and decides each cycle.',
  params: [],
  evaluate: async (ctx: StrategyContext, _params: ResolvedParams): Promise<StrategyResult> => {
    const decs = await getDecisions(
      { [ctx.asset]: ctx.snapshot },
      ctx.portfolio,
      ctx.maxPositionUsd,
      [], null, {}, ctx.regime
    )
    const dec = decs.find(d => d.asset === ctx.asset)
    if (!dec || dec.action === 'hold') {
      return { action: 'hold', confidence: 0.5, amount_usd: 0, reasoning: dec?.reasoning ?? 'No signal', signal: 'none', indicatorsUsed: ['LLM'] }
    }
    return {
      action:         dec.action,
      confidence:     dec.confidence,
      amount_usd:     dec.amount_usd,
      reasoning:      dec.reasoning,
      signal:         dec.confidence >= 0.75 ? 'strong' : dec.confidence >= 0.6 ? 'moderate' : 'weak',
      indicatorsUsed: ['LLM'],
    }
  },
}
// Register at module load time
registerLlmStrategy(llmStrategy)



