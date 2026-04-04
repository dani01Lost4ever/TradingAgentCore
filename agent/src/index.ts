import { config } from 'dotenv'
import { join } from 'path'
config({ path: join(__dirname, '../../.env') })
import { patchConsole, setLogBroadcaster } from './logs'
patchConsole()
import cron from 'node-cron'
import { createServer } from 'http'
import { connectDB } from './logger'
import { fetchPortfolio, fetchMarketSnapshot, fetchLatestPrices } from './poller'
import { getDecisions } from './brain'
import './brain'  // registers llmStrategy
import { getStrategy, mergeWithDefaults } from './strategies/registry'
import type { StrategyContext } from './strategies/types'
import { logDecision, markExecuted, resolveOutcomes } from './logger'
import { executeOrder } from './executor'
import { getConfig, initConfig } from './config'
import { createApiServer } from './api'
import { TradeModel } from './schema'
import { getRiskStatus, recordEquitySnapshot, monitorStopLossTakeProfit } from './risk'
import { fetchFearAndGreed, fetchNewsHeadlines } from './sentiment'
import { initWebSocket, broadcast } from './ws'
import { ensureAdminExists } from './auth'
import { loadKeysFromDB } from './keys'
import { isPaused } from './agentState'
import type { AssetSnapshot } from './schema'

const MAX_POSITION_USD = parseFloat(process.env.MAX_POSITION_USD || '500')
const API_PORT = parseInt(process.env.API_PORT || '3001')

// Rolling list of recently traded assets — passed to the LLM to encourage diversification
let recentAssets: string[] = []

function detectRegime(market: Record<string, AssetSnapshot>): string {
  const btc = market['BTC/USD']
  if (!btc?.daily_sma50) return 'Unknown'
  const pctFromSma50 = ((btc.price - btc.daily_sma50) / btc.daily_sma50) * 100
  if (pctFromSma50 > 5) return 'Bull Market (BTC +' + pctFromSma50.toFixed(1) + '% above SMA50)'
  if (pctFromSma50 < -10) return 'Bear Market (BTC ' + pctFromSma50.toFixed(1) + '% below SMA50)'
  return 'Sideways (BTC ' + (pctFromSma50 >= 0 ? '+' : '') + pctFromSma50.toFixed(1) + '% vs SMA50)'
}

async function runAgentCycle(): Promise<void> {
  if (isPaused()) {
    console.log('[agent] Cycle skipped — agent is paused')
    return
  }

  console.log('\n[agent] Starting cycle', new Date().toISOString())

  try {
    const [portfolio, market] = await Promise.all([
      fetchPortfolio(),
      fetchMarketSnapshot(getConfig().assets),
    ])

    // Broadcast portfolio update
    broadcast('portfolio', { cash: portfolio.cash_usd, equity: portfolio.equity_usd })

    console.log(`[agent] Portfolio: $${portfolio.cash_usd.toFixed(2)} cash, equity $${portfolio.equity_usd.toFixed(2)}`)

    // Circuit breaker check
    const riskStatus = await getRiskStatus(getConfig() as any, portfolio.equity_usd)
    if (riskStatus.circuitBreakerActive) {
      console.warn(`[agent] CIRCUIT BREAKER ACTIVE — ${riskStatus.circuitBreakerReason}`)
      await recordEquitySnapshot(portfolio)
      return
    }

    for (const [asset, snap] of Object.entries(market)) {
      const trend = snap.ema_9 != null && snap.ema_21 != null
        ? (snap.ema_9 > snap.ema_21 ? 'bullish' : 'bearish')
        : 'trend N/A'
      const macdStr = snap.macd_hist != null
        ? `MACD hist ${snap.macd_hist > 0 ? '+' : ''}${snap.macd_hist.toFixed(4)}`
        : 'MACD N/A'
      const bbStr = snap.bb_pct != null
        ? `BB% ${(snap.bb_pct * 100).toFixed(0)}%`
        : 'BB N/A'
      const rsiStr = snap.rsi_14 === 50 ? 'RSI 50 (fallback)' : `RSI ${snap.rsi_14}`
      console.log(`[agent] ${asset}: $${snap.price.toLocaleString()} | 24h ${snap.change_24h}% | 7d ${snap.change_7d ?? 'N/A'}% | ${rsiStr} | ${trend} | ${macdStr} | ${bbStr}`)
    }

    // Fetch sentiment in parallel
    const [fearGreed, news] = await Promise.all([
      fetchFearAndGreed(),
      fetchNewsHeadlines(getConfig().assets),
    ])
    if (fearGreed) {
      console.log(`[agent] Fear & Greed: ${fearGreed.value}/100 (${fearGreed.classification})`)
    }

    const regime = detectRegime(market)
    console.log(`[agent] Market regime: ${regime}`)

    const cfg = getConfig()
    const strategy = getStrategy(cfg.activeStrategy || 'llm')
    const resolvedParams = mergeWithDefaults(
      strategy.params,
      (cfg.strategyParams?.[cfg.activeStrategy] as any) ?? {}
    )

    // Evaluate strategy for each asset in parallel
    const stratResults = await Promise.all(
      Object.entries(market).map(async ([asset, snapshot]) => {
        const ctx: StrategyContext = {
          asset, snapshot, portfolio,
          maxPositionUsd: MAX_POSITION_USD,
          regime,
          fearGreedValue: fearGreed?.value ?? null,
        }
        const result = await strategy.evaluate(ctx, resolvedParams)
        return { asset, result }
      })
    )

    // Convert to the existing Decision shape
    const decisions = stratResults
      .filter(({ result }) => result.signal !== 'none')
      .map(({ asset, result }) => ({
        action:     result.action,
        asset,
        amount_usd: result.amount_usd,
        confidence: result.confidence,
        reasoning:  result.reasoning,
      }))

    // Log every asset's evaluation
    for (const d of decisions) {
      const flag = d.action === 'hold' ? '·' : d.action === 'buy' ? 'BUY' : 'SELL'
      console.log(`[brain] ${flag} ${d.asset}: ${d.action.toUpperCase()} $${d.amount_usd} (conf: ${(d.confidence * 100).toFixed(0)}%) — ${d.reasoning}`)
    }

    // Pick the highest-confidence non-hold decision
    const actionable = decisions
      .filter(d => d.action !== 'hold')
      .sort((a, b) => b.confidence - a.confidence)

    let decision = actionable[0] ?? decisions[0]  // fallback to first if all hold
    if (!decision) {
      console.log('[agent] No decisions returned — skipping cycle')
      await recordEquitySnapshot(portfolio)
      return
    }

    // Confidence threshold gating
    if (getConfig().confidenceThreshold > 0 && decision.action !== 'hold') {
      if (decision.confidence < getConfig().confidenceThreshold) {
        console.log(`[agent] Skipping ${decision.action} ${decision.asset} — confidence ${(decision.confidence * 100).toFixed(0)}% below threshold ${(getConfig().confidenceThreshold * 100).toFixed(0)}%`)
        decision = { ...decision, action: 'hold', amount_usd: 0 }
      }
    }

    // Kelly criterion position sizing
    if (getConfig().kellyEnabled && decision.action !== 'hold') {
      const { kellyPositionSize } = await import('./risk')
      decision.amount_usd = await kellyPositionSize(decision.asset, decision.amount_usd, MAX_POSITION_USD)
    }

    const record = await logDecision(market, portfolio, decision)
    broadcast('trade:new', record.toObject())

    if (decision.action !== 'hold') {
      // Track recently traded assets for next cycle's prompt
      recentAssets = [decision.asset, ...recentAssets].slice(0, 3)

      console.log(`[agent] Best signal: ${decision.action.toUpperCase()} ${decision.asset} $${decision.amount_usd} (conf: ${(decision.confidence * 100).toFixed(0)}%)`)
      if (getConfig().autoApprove) {
        console.log(`[agent] Auto-approving...`)
        const result = await executeOrder(decision)
        await markExecuted(record._id.toString(), result.order_id)
        const executedRecord = await TradeModel.findById(record._id).lean()
        broadcast('trade:executed', executedRecord)
        console.log(`[agent] Auto-executed order ${result.order_id}`)

        // Store SL/TP prices on the trade record
        const entryPrice = market[decision.asset]?.price
        if (entryPrice && result.order_id !== 'HOLD') {
          const slPrice = entryPrice * (1 - getConfig().stopLossPct / 100)
          const tpPrice = entryPrice * (1 + getConfig().takeProfitPct / 100)
          await TradeModel.findByIdAndUpdate(record._id, { sl_price: slPrice, tp_price: tpPrice })
          console.log(`[agent] SL: $${slPrice.toFixed(4)} | TP: $${tpPrice.toFixed(4)}`)

          if (getConfig().trailingStopEnabled) {
            const { PositionHighModel } = await import('./schema')
            await PositionHighModel.create({
              asset: decision.asset,
              tradeId: record._id.toString(),
              highPrice: entryPrice,
            })
          }
        }
      } else {
        console.log(`[agent] Awaiting human approval via dashboard`)
      }
    } else {
      console.log('[agent] All signals ambiguous — holding this cycle')
    }

    // Record equity snapshot at end of every cycle
    await recordEquitySnapshot(portfolio)
  } catch (err: any) {
    if (err.response) {
      console.error(
        `[agent] Cycle error: HTTP ${err.response.status} ${err.response.config?.url ?? ''} — ` +
        JSON.stringify(err.response.data).slice(0, 200)
      )
    } else {
      console.error('[agent] Cycle error:', err.message)
    }
  }
}

async function main(): Promise<void> {
  await connectDB()
  await initConfig()
  await loadKeysFromDB()
  await ensureAdminExists()

  // Start HTTP server with WebSocket support
  const app = createApiServer()
  const httpServer = createServer(app)
  initWebSocket(httpServer)
  setLogBroadcaster((entry) => broadcast('log_line', entry))
  httpServer.listen(API_PORT, () => {
    console.log(`[api] Server listening on port ${API_PORT}`)
  })

  // Run first cycle immediately on startup
  await runAgentCycle()

  // Dynamic scheduler — re-reads cycleMinutes after every cycle so changes
  // made in the Settings page take effect without restarting the agent.
  const scheduleNext = () => {
    const mins = getConfig().cycleMinutes
    console.log(`[agent] Next cycle in ${mins} minute(s)`)
    setTimeout(async () => {
      await runAgentCycle()
      scheduleNext()
    }, mins * 60 * 1000)
  }
  scheduleNext()

  // Resolve outcomes every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[agent] Running outcome resolution...')
    await resolveOutcomes()
  })

  // SL/TP monitor every 2 minutes
  cron.schedule('*/2 * * * *', async () => {
    try {
      const prices = await fetchLatestPrices(getConfig().assets)
      await monitorStopLossTakeProfit(prices)
    } catch (err: any) {
      console.error('[agent] SL/TP monitor error:', err.message)
    }
  })

  // Price ticker broadcast every 60 seconds
  setInterval(async () => {
    try {
      const prices = await fetchLatestPrices(getConfig().assets)
      const tick: Record<string, { price: number; change24h: number }> = {}
      for (const [asset, snap] of Object.entries(prices)) {
        tick[asset] = { price: snap.price, change24h: snap.change_24h }
      }
      broadcast('price_tick', tick)
    } catch { /* ignore */ }
  }, 60_000)

  console.log('[agent] Running. Press Ctrl+C to stop.')
}

main().catch(err => {
  console.error('[agent] Fatal:', err)
  process.exit(1)
})
