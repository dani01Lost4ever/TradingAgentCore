import 'dotenv/config'
import { patchConsole } from './logs'
patchConsole()
import cron from 'node-cron'
import { connectDB } from './logger'
import { fetchPortfolio, fetchMarketSnapshot } from './poller'
import { getDecision } from './brain'
import { logDecision, markExecuted, resolveOutcomes } from './logger'
import { executeOrder } from './executor'
import { getConfig } from './config'
import { createApiServer } from './api'

const ASSETS = (process.env.ASSETS || 'BTC/USD,ETH/USD').split(',')
const MAX_POSITION_USD = parseFloat(process.env.MAX_POSITION_USD || '500')
const POLL_MINUTES = parseInt(process.env.POLL_INTERVAL_MINUTES || '15')
const API_PORT = parseInt(process.env.API_PORT || '3001')

async function runAgentCycle(): Promise<void> {
  console.log('\n[agent] ── Starting cycle', new Date().toISOString())

  try {
    const [portfolio, market] = await Promise.all([
      fetchPortfolio(),
      fetchMarketSnapshot(ASSETS),
    ])

    console.log(`[agent] Portfolio: $${portfolio.cash_usd.toFixed(2)} cash, equity $${portfolio.equity_usd.toFixed(2)}`)
    for (const [asset, snap] of Object.entries(market)) {
      console.log(`[agent] ${asset}: $${snap.price.toLocaleString()} (${snap.change_24h}% 24h, RSI ${snap.rsi_14})`)
    }

    const decision = await getDecision(market, portfolio, MAX_POSITION_USD)
    console.log(`[agent] Decision: ${decision.action.toUpperCase()} ${decision.asset} $${decision.amount_usd} (confidence: ${decision.confidence})`)
    console.log(`[agent] Reasoning: ${decision.reasoning}`)

    const record = await logDecision(market, portfolio, decision)

    if (decision.action !== 'hold') {
      if (getConfig().autoApprove) {
        console.log(`[agent] 🤖 Auto-approving ${decision.action.toUpperCase()} ${decision.asset} $${decision.amount_usd}...`)
        const result = await executeOrder(decision)
        await markExecuted(record._id.toString(), result.order_id)
        console.log(`[agent] ✓ Auto-executed order ${result.order_id}`)
      } else {
        console.log(`[agent] ⚠️  Non-hold decision logged — awaiting human approval via dashboard`)
      }
    }
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

  // Start API server for dashboard
  const app = createApiServer()
  app.listen(API_PORT, () => {
    console.log(`[api] Server listening on port ${API_PORT}`)
  })

  // Run first cycle immediately on startup
  await runAgentCycle()

  // Schedule polling cycle
  const cronExpr = `*/${POLL_MINUTES} * * * *`
  cron.schedule(cronExpr, runAgentCycle)
  console.log(`[agent] Polling every ${POLL_MINUTES} minutes (${cronExpr})`)

  // Resolve outcomes every hour
  cron.schedule('0 * * * *', async () => {
    console.log('[agent] Running outcome resolution...')
    await resolveOutcomes()
  })

  console.log('[agent] Running. Press Ctrl+C to stop.')
}

main().catch(err => {
  console.error('[agent] Fatal:', err)
  process.exit(1)
})
