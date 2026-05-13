import Anthropic from '@anthropic-ai/sdk'
import { DiscoveryRunModel, DiscoveryRunDoc } from './schema'
import { TradingMode } from './config'
import { getKey, getAdapterForUser } from './keys'
import type { AssetSnapshot } from './schema'
import { AlpacaAdapter } from './exchanges/alpaca'

export interface DiscoveryCandidate {
  symbol: string
  reason: string
  score: number   // 0..1
}

// ── Hardcoded universe lists ──────────────────────────────────────────────────

const SP500_TOP50 = [
  'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'BRK.B', 'LLY', 'TSLA', 'V',
  'JPM', 'WMT', 'XOM', 'UNH', 'MA', 'PG', 'JNJ', 'HD', 'AVGO', 'COST',
  'MRK', 'ABBV', 'ADBE', 'CVX', 'KO', 'PEP', 'BAC', 'CRM', 'MCD', 'TMO',
  'ABT', 'ACN', 'LIN', 'NFLX', 'AMD', 'DHR', 'WFC', 'DIS', 'TXN', 'PM',
  'ORCL', 'NEE', 'VZ', 'INTC', 'RTX', 'CMCSA', 'NKE', 'T', 'IBM', 'SPGI',
]

const CRYPTO_TOP10 = [
  'BTC/USD', 'ETH/USD', 'SOL/USD', 'XRP/USD', 'ADA/USD',
  'AVAX/USD', 'DOT/USD', 'MATIC/USD', 'LINK/USD', 'ATOM/USD',
]

function sampleN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, n)
}

// ── LLM-based ranking (opt-in via DISCOVERY_LLM=true) ────────────────────────
// Pros: single Claude API call, subjective context, no market data needed.
// Cons: costs money per run, doesn't use live signals.

async function rankWithLlm(
  candidates: string[],
  tradingMode: TradingMode,
  userId: string,
): Promise<DiscoveryCandidate[]> {
  const apiKey = getKey('anthropic_api_key')
  if (!apiKey) {
    return candidates.map(symbol => ({ symbol, reason: 'Sampled candidate', score: 0.5 }))
  }

  const client = new Anthropic({ apiKey })
  const prompt = `You are a trading analyst. Given the following candidate assets for a ${tradingMode.replace('_', '-')} strategy, rank the best 5 by current market opportunity. For each, give a brief reason (max 10 words) and a score 0..1.

Candidates: ${candidates.join(', ')}

Respond ONLY with a JSON array:
[{"symbol":"...","reason":"...","score":0.0}, ...]
Return exactly 5 items. No markdown.`

  try {
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{ role: 'user', content: prompt }],
    })
    const block = msg.content[0]
    if (block.type !== 'text') throw new Error('Unexpected response type')
    const cleaned = block.text.replace(/```json|```/g, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!Array.isArray(parsed)) throw new Error('Not array')
    return parsed.slice(0, 5).map((item: any) => ({
      symbol: String(item.symbol || ''),
      reason: String(item.reason || 'LLM ranked'),
      score: Math.max(0, Math.min(1, Number(item.score) || 0.5)),
    })).filter(c => c.symbol)
  } catch (err: any) {
    console.warn('[discovery] LLM ranking failed:', err.message)
    return candidates.slice(0, 5).map(symbol => ({ symbol, reason: 'Sampled candidate', score: 0.5 }))
  }
}

// ── Signal-based ranking (default path, no cost) ─────────────────────────────
// Fetches market snapshots for each candidate (~2-5s for 20 symbols) and
// computes a composite score from RSI, EMA trend, ATR volatility, volume, and
// 7-day change. Weights differ per trading mode (see below).
//
// Tradeoff vs LLM path:
//   - Signal path: ~2-5s latency (parallel fetch not possible — sequential per Alpaca),
//     free, deterministic, reflects current live data.
//   - LLM path (DISCOVERY_LLM=true): ~1-2s latency but costs $0.001-0.005 per run,
//     introduces non-determinism, and doesn't use actual market numbers.
//   Use LLM path only if you want narrative explanations not derivable from signals.

function scoreTrend(snap: AssetSnapshot): number {
  const emaUp = snap.ema_9 !== undefined && snap.ema_21 !== undefined && snap.ema_9 > snap.ema_21
  const aboveSma50 = snap.daily_sma50 !== undefined && snap.price > snap.daily_sma50
  if (emaUp && aboveSma50) return 1.0
  if (!emaUp && !aboveSma50) return 0.1
  return 0.5   // mixed
}

function scoreMomentum(snap: AssetSnapshot): number {
  const rsi = snap.rsi_14
  if (rsi === undefined) return 0.5
  if (rsi >= 45 && rsi <= 65) return 1.0
  if ((rsi >= 35 && rsi < 45) || (rsi > 65 && rsi <= 75)) return 0.6
  return 0.2   // oversold (<35) or overbought (>75)
}

function scoreVolatility(snap: AssetSnapshot): number {
  if (snap.atr_14 === undefined || snap.price <= 0) return 0.5
  const atrPct = (snap.atr_14 / snap.price) * 100
  if (atrPct >= 0.8 && atrPct <= 2.5) return 1.0
  // Scale down linearly outside the healthy band
  if (atrPct < 0.8) return Math.max(0.1, atrPct / 0.8)
  // atrPct > 2.5 — too volatile
  return Math.max(0.1, 1.0 - ((atrPct - 2.5) / 10))
}

function scoreVolume(snap: AssetSnapshot): number {
  if (snap.volume_sma20 === undefined || snap.volume_sma20 === 0) return 0.5
  return snap.volume_24h > snap.volume_sma20 ? 1.0 : 0.4
}

function score7dChange(snap: AssetSnapshot): number {
  const ch = snap.change_7d
  if (ch === undefined) return 0.5
  if (ch >= -3 && ch <= 6) return 1.0   // calm or measured uptrend
  if (ch > 10) return 0.3               // chased / extended
  if (ch < -8) return 0.2              // knife-catcher territory
  // Between 6-10% or -8 to -3%: interpolate
  if (ch > 6) return 1.0 - ((ch - 6) / 4) * 0.7
  return 0.2 + ((ch + 8) / 5) * 0.8
}

interface ModeWeights {
  trend: number
  momentum: number
  volatility: number
  volume: number
  change7d: number
}

const WEIGHTS: Record<TradingMode, ModeWeights> = {
  long_term: { trend: 0.40, momentum: 0.25, volatility: 0.15, volume: 0.10, change7d: 0.10 },
  scalp:     { trend: 0.15, momentum: 0.35, volatility: 0.30, volume: 0.15, change7d: 0.05 },
  swing:     { trend: 0.30, momentum: 0.30, volatility: 0.20, volume: 0.15, change7d: 0.05 },
}

function buildReason(snap: AssetSnapshot): string {
  const parts: string[] = []

  if (snap.rsi_14 !== undefined) {
    const r = snap.rsi_14.toFixed(0)
    if (snap.rsi_14 > 70) parts.push(`RSI ${r} overbought`)
    else if (snap.rsi_14 < 30) parts.push(`RSI ${r} oversold`)
    else parts.push(`RSI ${r}`)
  }

  if (snap.ema_9 !== undefined && snap.ema_21 !== undefined) {
    parts.push(snap.ema_9 > snap.ema_21 ? 'EMA9>EMA21' : 'EMA9<EMA21')
  }

  if (snap.change_7d !== undefined) {
    const sign = snap.change_7d >= 0 ? '+' : ''
    parts.push(`${sign}${snap.change_7d.toFixed(1)}% 7d`)
  }

  if (snap.volume_sma20 !== undefined && snap.volume_sma20 > 0) {
    const ratio = snap.volume_24h / snap.volume_sma20
    parts.push(`vol ${ratio.toFixed(1)}x avg`)
  }

  if (parts.length === 0) return 'Scored from available signals'

  // Append a short verdict
  const trendUp = snap.ema_9 !== undefined && snap.ema_21 !== undefined && snap.ema_9 > snap.ema_21
  const aboveSma50 = snap.daily_sma50 !== undefined && snap.price > snap.daily_sma50
  const rsi = snap.rsi_14 ?? 50

  let verdict = ''
  if (trendUp && aboveSma50 && rsi >= 45 && rsi <= 65) verdict = 'healthy uptrend'
  else if (!trendUp && rsi < 40) verdict = 'downtrend, avoid'
  else if (rsi > 72) verdict = 'extended, wait for pullback'
  else if (trendUp) verdict = 'uptrend'
  else verdict = 'mixed signals'

  return parts.join(', ') + ' — ' + verdict
}

async function rankWithSignals(
  candidates: string[],
  userId: string,
  tradingMode: TradingMode,
): Promise<DiscoveryCandidate[]> {
  const adapter = await getAdapterForUser(userId)
  const weights = WEIGHTS[tradingMode]

  // fetchMarketSnapshot already handles per-symbol errors internally and skips
  // symbols that fail. We wrap the whole call in try/catch as an additional guard.
  let snapshots: Record<string, AssetSnapshot> = {}
  try {
    snapshots = await adapter.fetchMarketSnapshot(candidates)
  } catch (err: any) {
    console.warn('[discovery] fetchMarketSnapshot failed entirely:', err.message)
    // Fall through with empty snapshots — every candidate gets score=0
  }

  const results: DiscoveryCandidate[] = candidates.map(symbol => {
    const snap = snapshots[symbol]
    if (!snap) {
      return { symbol, reason: 'No market data available', score: 0 }
    }

    const composite =
      weights.trend      * scoreTrend(snap) +
      weights.momentum   * scoreMomentum(snap) +
      weights.volatility * scoreVolatility(snap) +
      weights.volume     * scoreVolume(snap) +
      weights.change7d   * score7dChange(snap)

    return {
      symbol,
      reason: buildReason(snap),
      score: parseFloat(composite.toFixed(4)),
    }
  })

  // Sort descending by score, return top 10 so the table fits on screen.
  results.sort((a, b) => b.score - a.score)
  return results.slice(0, 10)
}

// ── Main entrypoint ───────────────────────────────────────────────────────────

export async function runDiscovery(
  userId: string,
  walletId: string,
  tradingMode: TradingMode,
): Promise<DiscoveryRunDoc> {
  let candidates: string[]
  let source: string

  if (tradingMode === 'long_term') {
    candidates = sampleN(SP500_TOP50, 20)
    source = 'sp500_top50'
  } else if (tradingMode === 'scalp') {
    candidates = [...CRYPTO_TOP10]
    source = 'crypto_top10'
  } else {
    // swing: union, sample 15
    const union = [...CRYPTO_TOP10, ...SP500_TOP50]
    candidates = sampleN(union, 15)
    source = 'swing_union'
  }

  let discoveryResults: DiscoveryCandidate[]

  // ── Ranking path selection ────────────────────────────────────────────────
  // DISCOVERY_LLM=true  → Claude Haiku call: one API round-trip (~1-2s), costs
  //                        money, gives narrative reasons but no live numbers.
  // default (false)     → Signal-based: fetches market snapshots (~2-5s for 20
  //                        symbols sequentially), free, uses RSI/EMA/ATR/vol.
  if (process.env.DISCOVERY_LLM === 'true') {
    discoveryResults = await rankWithLlm(candidates, tradingMode, userId)
  } else {
    discoveryResults = await rankWithSignals(candidates, userId, tradingMode)
  }

  const doc = await DiscoveryRunModel.create({
    userId,
    walletId,
    ts: new Date(),
    tradingMode,
    candidates: discoveryResults,
    source,
  })

  console.log(`[discovery] Completed run for wallet ${walletId} (${tradingMode}): ${discoveryResults.length} candidates`)
  return doc
}
