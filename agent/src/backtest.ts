import axios from 'axios'
import { BacktestResultModel, BacktestTradeDoc, AssetSnapshot } from './schema'
import { getKey } from './keys'
import { getDecisions } from './brain'
import type { Portfolio } from './poller'

export interface BacktestParams {
  assets: string[]
  startDate: string
  endDate: string
  cycleHours: number
  model: string
  mode: 'rules' | 'llm'
  startEquity: number
  maxPositionUsd: number
  strategyId?: string
  strategyParams?: Record<string, any>
  saveToDb?: boolean
}

export interface BacktestResult {
  runAt: Date
  params: { assets: string[]; startDate: string; endDate: string; cycleHours: number; model: string; mode: 'rules' | 'llm' }
  trades: BacktestTradeDoc[]
  startEquity: number
  finalEquity: number
  totalReturn: number
  maxDrawdown: number
  winRate: number
  totalTrades: number
  sharpe?: number
  sortino?: number
  strategyId?: string
}

const ALPACA_DATA = 'https://data.alpaca.markets'

function alpacaHeaders() {
  return {
    'APCA-API-KEY-ID':     getKey('alpaca_api_key')    || '',
    'APCA-API-SECRET-KEY': getKey('alpaca_api_secret') || '',
  }
}

// ─── Indicator helpers (copied from poller.ts) ────────────────────────────────

function computeEMA(values: number[], period: number): number[] {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  const result = [ema]
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k)
    result.push(ema)
  }
  return result
}

function computeRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50
  let gains = 0
  let losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = avgGain / avgLoss
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2))
}

function computeMACD(closes: number[]): { macd: number; signal: number; hist: number } | null {
  const ema12 = computeEMA(closes, 12)
  const ema26 = computeEMA(closes, 26)
  if (!ema12.length || !ema26.length) return null
  const offset = ema12.length - ema26.length
  const macdLine = ema26.map((v, i) => ema12[i + offset] - v)
  const signalLine = computeEMA(macdLine, 9)
  if (!signalLine.length) return null
  const lastMacd   = macdLine[macdLine.length - 1]
  const lastSignal = signalLine[signalLine.length - 1]
  return {
    macd:   parseFloat(lastMacd.toFixed(6)),
    signal: parseFloat(lastSignal.toFixed(6)),
    hist:   parseFloat((lastMacd - lastSignal).toFixed(6)),
  }
}

function computeBollingerBands(closes: number[], period = 20): { upper: number; lower: number; pct: number } | null {
  if (closes.length < period) return null
  const slice    = closes.slice(-period)
  const sma      = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period
  const sd       = Math.sqrt(variance)
  const upper    = sma + 2 * sd
  const lower    = sma - 2 * sd
  const price    = closes[closes.length - 1]
  const pct      = upper === lower ? 0.5 : (price - lower) / (upper - lower)
  return {
    upper: parseFloat(upper.toFixed(6)),
    lower: parseFloat(lower.toFixed(6)),
    pct:   parseFloat(pct.toFixed(3)),
  }
}

function computeATR(bars: any[], period = 14): number | null {
  if (bars.length < period + 1) return null
  const trValues: number[] = []
  for (let i = 1; i < bars.length; i++) {
    trValues.push(Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    ))
  }
  const atrArr = computeEMA(trValues, period)
  if (!atrArr.length) return null
  return parseFloat(atrArr[atrArr.length - 1].toFixed(6))
}

function barsToSnapshot(bars: any[]): AssetSnapshot | null {
  if (!bars.length) return null
  const latest  = bars[bars.length - 1]
  const prev24h = bars.length >= 24 ? bars[bars.length - 24] : bars[0]
  const closes  = bars.map((b: any) => b.c)

  const rsi      = computeRSI(closes, 14)
  const ema9arr  = computeEMA(closes, 9)
  const ema21arr = computeEMA(closes, 21)
  const macdData = computeMACD(closes)
  const bb       = computeBollingerBands(closes)
  const atr      = computeATR(bars)

  return {
    price:       latest.c,
    change_24h:  parseFloat((((latest.c - prev24h.o) / prev24h.o) * 100).toFixed(2)),
    volume_24h:  bars.slice(-24).reduce((s: number, b: any) => s + b.v, 0),
    high_24h:    Math.max(...bars.slice(-24).map((b: any) => b.h)),
    low_24h:     Math.min(...bars.slice(-24).map((b: any) => b.l)),
    rsi_14:      rsi,
    ema_9:       ema9arr.length  ? parseFloat(ema9arr[ema9arr.length - 1].toFixed(6))   : undefined,
    ema_21:      ema21arr.length ? parseFloat(ema21arr[ema21arr.length - 1].toFixed(6)) : undefined,
    macd:        macdData?.macd,
    macd_signal: macdData?.signal,
    macd_hist:   macdData?.hist,
    bb_upper:    bb?.upper,
    bb_lower:    bb?.lower,
    bb_pct:      bb?.pct,
    atr_14:      atr ?? undefined,
  }
}

// ─── Fetch all hourly bars for an asset between two dates ─────────────────────

async function fetchAllBars(asset: string, startDate: string, endDate: string): Promise<any[]> {
  const allBars: any[] = []
  let pageToken: string | undefined

  try {
    do {
      const params: Record<string, any> = {
        symbols:   asset,
        timeframe: '1H',
        start:     startDate,
        end:       endDate,
        limit:     1000,
      }
      if (pageToken) params.page_token = pageToken

      const res = await axios.get(`${ALPACA_DATA}/v1beta3/crypto/us/bars`, {
        headers: alpacaHeaders(),
        params,
      })

      const bars: any[] = res.data.bars?.[asset] || []
      allBars.push(...bars)
      pageToken = res.data.next_page_token
    } while (pageToken)
  } catch (err: any) {
    console.warn(`[backtest] Failed to fetch bars for ${asset}: ${err.message}`)
  }

  return allBars
}

// ─── Rules-based decision ─────────────────────────────────────────────────────

interface SimpleDecision {
  action: 'buy' | 'sell' | 'hold'
  confidence: number
  amount_usd: number
}

function rulesDecision(snap: AssetSnapshot, maxPositionUsd: number): SimpleDecision {
  const rsi = snap.rsi_14 ?? 50
  if (rsi < 35) return { action: 'buy',  confidence: 0.7, amount_usd: maxPositionUsd }
  if (rsi > 65) return { action: 'sell', confidence: 0.7, amount_usd: maxPositionUsd }
  return { action: 'hold', confidence: 0.5, amount_usd: 0 }
}

// ─── Main backtester ──────────────────────────────────────────────────────────

export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  console.log(`[backtest] Starting run: ${params.startDate} → ${params.endDate}, ${params.assets.join(', ')}, mode=${params.mode}`)

  // Resolve strategy
  const { getStrategy, mergeWithDefaults } = await import('./strategies/registry')
  const stratId = params.strategyId ?? (params.mode === 'llm' ? 'llm' : 'momentum')
  const strategy = getStrategy(stratId)
  const resolvedParams = mergeWithDefaults(strategy.params, (params.strategyParams as any) ?? {})

  // 1. Fetch all bars for each asset
  const allBarsMap: Record<string, any[]> = {}
  for (const asset of params.assets) {
    allBarsMap[asset] = await fetchAllBars(asset, params.startDate, params.endDate)
    console.log(`[backtest] ${asset}: ${allBarsMap[asset].length} bars fetched`)
  }

  // 2. Set up portfolio simulation
  let cash      = params.startEquity
  let peakEquity = params.startEquity
  const positions: Record<string, { qty: number; entryPrice: number; amountUsd: number }> = {}
  const tradeLog: BacktestTradeDoc[] = []
  let wins = 0
  let totalTrades = 0

  const start = new Date(params.startDate).getTime()
  const end   = new Date(params.endDate).getTime()
  const stepMs = params.cycleHours * 60 * 60 * 1000

  // 3. Walk forward
  for (let ts = start; ts < end; ts += stepMs) {
    const tsDate = new Date(ts)

    // Build market snapshot from bars available up to this timestamp (last 100)
    const market: Record<string, AssetSnapshot> = {}
    for (const asset of params.assets) {
      const barsUpTo = allBarsMap[asset].filter((b: any) => new Date(b.t).getTime() <= ts)
      const slice    = barsUpTo.slice(-100)
      if (slice.length < 2) continue
      const snap = barsToSnapshot(slice)
      if (snap) market[asset] = snap
    }

    if (Object.keys(market).length === 0) continue

    // Compute equity for drawdown tracking (open positions at current prices)
    let posValue = 0
    for (const [asset, pos] of Object.entries(positions)) {
      const snap = market[asset]
      if (snap) posValue += pos.qty * snap.price
    }
    const equity = cash + posValue
    if (equity > peakEquity) peakEquity = equity

    // 4. Get decisions via strategy
    try {
      const btPortfolio: Portfolio = {
        cash_usd:   cash,
        equity_usd: equity,
        positions:  Object.fromEntries(Object.entries(positions).map(([a, p]) => [a, p.qty])),
      }

      for (const asset of params.assets) {
        const snap = market[asset]
        if (!snap) continue
        const ctx = {
          asset, snapshot: snap, portfolio: btPortfolio,
          maxPositionUsd: params.maxPositionUsd,
          regime: 'Unknown', fearGreedValue: null,
        }
        const result = await strategy.evaluate(ctx as any, resolvedParams)
        if (result.signal === 'none' || result.action === 'hold') continue

        const price = snap.price

        if (result.action === 'buy' && !positions[asset]) {
          const spend = Math.min(result.amount_usd, cash)
          if (spend < 1) continue
          const qty = spend / price
          positions[asset] = { qty, entryPrice: price, amountUsd: spend }
          cash -= spend
          tradeLog.push({ ts: tsDate, asset, action: 'buy', price, amount_usd: spend, confidence: result.confidence, pnl_usd: 0 })
          totalTrades++
        } else if (result.action === 'sell' && positions[asset]) {
          const pos      = positions[asset]
          const proceeds = pos.qty * price
          const pnl_usd  = proceeds - pos.amountUsd
          if (pnl_usd > 0) wins++
          cash += proceeds
          delete positions[asset]
          tradeLog.push({ ts: tsDate, asset, action: 'sell', price, amount_usd: proceeds, confidence: result.confidence, pnl_usd })
          totalTrades++
        }
      }
    } catch (err: any) {
      console.warn(`[backtest] Strategy call failed at ${tsDate.toISOString()}: ${err.message}`)
    }
  }

  // Close all remaining open positions at last available price
  for (const [asset, pos] of Object.entries(positions)) {
    const bars = allBarsMap[asset]
    if (!bars.length) continue
    const lastBar = bars[bars.length - 1]
    const price   = lastBar.c
    const proceeds = pos.qty * price
    const pnl_usd  = proceeds - pos.amountUsd
    if (pnl_usd > 0) wins++
    cash += proceeds
    totalTrades++
    tradeLog.push({ ts: new Date(end), asset, action: 'sell', price, amount_usd: proceeds, confidence: 1, pnl_usd })
  }

  const finalEquity  = cash
  const totalReturn  = parseFloat((((finalEquity - params.startEquity) / params.startEquity) * 100).toFixed(2))
  const maxDrawdown  = parseFloat((((peakEquity - finalEquity) / peakEquity) * 100).toFixed(2))
  const winRate      = totalTrades > 0 ? parseFloat(((wins / totalTrades) * 100).toFixed(2)) : 0

  // Build equity curve from trades
  const equityCurve: number[] = [params.startEquity]
  let eq = params.startEquity
  for (const t of tradeLog) {
    eq += t.pnl_usd
    equityCurve.push(eq)
  }

  // Periodic returns
  const returns: number[] = []
  for (let i = 1; i < equityCurve.length; i++) {
    if (equityCurve[i - 1] !== 0) {
      returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1])
    }
  }

  // Annualisation factor: crypto trades 24/7
  const periodsPerYear = 8760 / params.cycleHours
  const sqrtPPY = Math.sqrt(periodsPerYear)

  let sharpe = 0
  let sortino = 0
  if (returns.length > 1) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / returns.length
    const std = Math.sqrt(variance)
    sharpe = std > 0 ? parseFloat(((mean / std) * sqrtPPY).toFixed(3)) : 0

    const downsideReturns = returns.filter(r => r < 0)
    if (downsideReturns.length > 0) {
      const downsideVariance = downsideReturns.reduce((a, r) => a + r ** 2, 0) / downsideReturns.length
      const downsideStd = Math.sqrt(downsideVariance)
      sortino = downsideStd > 0 ? parseFloat(((mean / downsideStd) * sqrtPPY).toFixed(3)) : 0
    }
  }

  const result: BacktestResult = {
    runAt:       new Date(),
    params:      { assets: params.assets, startDate: params.startDate, endDate: params.endDate, cycleHours: params.cycleHours, model: params.model, mode: params.mode },
    trades:      tradeLog,
    startEquity: params.startEquity,
    finalEquity,
    totalReturn,
    maxDrawdown,
    winRate,
    totalTrades,
    sharpe,
    sortino,
    strategyId: stratId,
  }

  // Save to DB
  if (params.saveToDb !== false) {
    try {
      await BacktestResultModel.create(result)
    } catch (err: any) {
      console.warn(`[backtest] Failed to save result: ${err.message}`)
    }
  }

  console.log(`[backtest] Done — return: ${totalReturn}%, maxDD: ${maxDrawdown}%, winRate: ${winRate}%, trades: ${totalTrades}`)
  return result
}
