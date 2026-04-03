import { TradeModel, EquityModel, AssetSnapshot } from './schema'
import { AgentConfig } from './config'
import { executeOrder } from './executor'
import { markExecuted } from './logger'
import { Portfolio } from './poller'

// High-correlation groups — avoid trading multiple from same group per cycle
const CORRELATION_GROUPS: string[][] = [
  ['BTC/USD', 'ETH/USD', 'SOL/USD', 'AVAX/USD'],
  ['UNI/USD', 'AAVE/USD', 'LINK/USD'],
]

export interface RiskStatus {
  circuitBreakerActive: boolean
  circuitBreakerReason?: string
  openPositions: number
  todayPnl: number
  maxDrawdownPct: number
  maxOpenPositions: number
}

export async function getRiskStatus(config: AgentConfig, equity: number): Promise<RiskStatus> {
  const openPositions = await TradeModel.countDocuments({
    executed: true,
    outcome: { $exists: false },
    'decision.action': 'buy',
  })

  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const todayTrades = await TradeModel.find({
    executed: true,
    'outcome.pnl_usd': { $exists: true },
    'outcome.resolved_at': { $gte: todayStart },
  }).lean()
  const todayPnl = todayTrades.reduce((s, t) => s + (t.outcome?.pnl_usd ?? 0), 0)

  const maxDrawdownUsd = (config.maxDrawdownPct / 100) * equity
  const circuitBreakerActive = todayPnl < -Math.abs(maxDrawdownUsd)

  return {
    circuitBreakerActive,
    circuitBreakerReason: circuitBreakerActive
      ? `Daily P&L $${todayPnl.toFixed(2)} exceeded max drawdown limit of -${config.maxDrawdownPct}%`
      : undefined,
    openPositions,
    todayPnl,
    maxDrawdownPct: config.maxDrawdownPct,
    maxOpenPositions: config.maxOpenPositions,
  }
}

export function isCorrelated(asset: string, recentAssets: string[]): boolean {
  for (const group of CORRELATION_GROUPS) {
    if (group.includes(asset) && recentAssets.some(r => group.includes(r) && r !== asset)) return true
  }
  return false
}

export function computeAtrPositionSize(
  atr: number | undefined,
  price: number,
  maxPositionUsd: number
): number {
  if (!atr || !price) return maxPositionUsd
  const atrPct = (atr / price) * 100
  let scale = 1.0
  if (atrPct > 5)      scale = 0.3
  else if (atrPct > 3) scale = 0.5
  else if (atrPct > 2) scale = 0.7
  else if (atrPct > 1) scale = 0.85
  return parseFloat((maxPositionUsd * scale).toFixed(2))
}

// Record equity snapshot after each cycle
export async function recordEquitySnapshot(portfolio: Portfolio): Promise<void> {
  const lastSnap = await EquityModel.findOne().sort({ ts: -1 }).lean()
  const peak = Math.max(portfolio.equity_usd, lastSnap?.peak ?? portfolio.equity_usd)
  await EquityModel.create({ equity: portfolio.equity_usd, cash: portfolio.cash_usd, peak })
}

// Cron job: check SL/TP for all open buy positions
export async function monitorStopLossTakeProfit(
  currentPrices: Record<string, AssetSnapshot>
): Promise<void> {
  const openTrades = await TradeModel.find({
    executed: true,
    outcome: { $exists: false },
    'decision.action': 'buy',
    sl_price: { $exists: true },
  }).lean()

  for (const trade of openTrades) {
    const snap = currentPrices[trade.decision.asset]
    if (!snap) continue
    const currentPrice = snap.price
    const slPrice = (trade as any).sl_price as number | undefined
    const tpPrice = (trade as any).tp_price as number | undefined
    let triggered: 'sl' | 'tp' | null = null
    if (slPrice && currentPrice <= slPrice) triggered = 'sl'
    else if (tpPrice && currentPrice >= tpPrice) triggered = 'tp'
    if (!triggered) continue

    console.log(`[risk] ${triggered.toUpperCase()} triggered for ${trade.decision.asset} @ $${currentPrice}`)
    try {
      const result = await executeOrder({
        action: 'sell',
        asset: trade.decision.asset,
        amount_usd: trade.decision.amount_usd,
        confidence: 1.0,
        reasoning: `${triggered.toUpperCase()} triggered at $${currentPrice}`,
      })
      await markExecuted(trade._id.toString(), result.order_id)
      await TradeModel.findByIdAndUpdate(trade._id, {
        close_reason: triggered,
        closed_at: new Date(),
      })
      console.log(`[risk] Closed ${trade.decision.asset} via ${triggered.toUpperCase()}`)
    } catch (err: any) {
      console.error(`[risk] Failed to close position: ${err.message}`)
    }
  }
}
