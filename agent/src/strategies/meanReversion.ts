import type { StrategyMeta, StrategyContext, ResolvedParams, StrategyResult } from './types'
import { holdResult } from './types'
import { computeAtrPositionSize } from '../risk'

export const meanReversion: StrategyMeta = {
  id: 'meanReversion',
  label: 'Mean Reversion (BB)',
  description: 'Buys when price touches lower Bollinger Band; sells at upper band. Counter-trend.',
  params: [
    { key: 'bbBuy',          label: 'BB% Buy level',      type: 'number', default: 0.10, min: 0, max: 0.3, step: 0.01, gridValues: [0.05, 0.10, 0.15, 0.20] },
    { key: 'bbSell',         label: 'BB% Sell level',     type: 'number', default: 0.90, min: 0.7, max: 1.0, step: 0.01, gridValues: [0.80, 0.85, 0.90, 0.95] },
    { key: 'rsiConfirm',     label: 'RSI confirm',        type: 'boolean', default: true, help: 'Require RSI < 40 on buy, > 60 on sell' },
    { key: 'rsiConfirmBuy',  label: 'RSI confirm (buy)',  type: 'number', default: 40, min: 25, max: 50, step: 1 },
    { key: 'rsiConfirmSell', label: 'RSI confirm (sell)', type: 'number', default: 60, min: 50, max: 75, step: 1 },
  ],
  evaluate: async (ctx: StrategyContext, p: ResolvedParams): Promise<StrategyResult> => {
    const { snapshot: s, maxPositionUsd } = ctx
    const bbPct = s.bb_pct
    const rsi = s.rsi_14 ?? 50
    if (bbPct == null) return holdResult('No Bollinger Band data', ['BB'])
    const amt = computeAtrPositionSize(s.atr_14, s.price, maxPositionUsd)

    const rsiOk_buy  = !p.rsiConfirm || rsi < (p.rsiConfirmBuy as number)
    const rsiOk_sell = !p.rsiConfirm || rsi > (p.rsiConfirmSell as number)

    if (bbPct < (p.bbBuy as number) && rsiOk_buy) {
      const conf = Math.min(0.92, 0.60 + ((p.bbBuy as number) - bbPct) * 2)
      return {
        action: 'buy', confidence: conf, amount_usd: amt,
        reasoning: `BB% ${(bbPct*100).toFixed(0)}% — oversold, RSI ${rsi.toFixed(0)}`,
        signal: conf >= 0.75 ? 'strong' : 'moderate',
        indicatorsUsed: ['BB', 'RSI'],
      }
    }
    if (bbPct > (p.bbSell as number) && rsiOk_sell) {
      const conf = Math.min(0.92, 0.60 + (bbPct - (p.bbSell as number)) * 2)
      return {
        action: 'sell', confidence: conf, amount_usd: amt,
        reasoning: `BB% ${(bbPct*100).toFixed(0)}% — overbought, RSI ${rsi.toFixed(0)}`,
        signal: conf >= 0.75 ? 'strong' : 'moderate',
        indicatorsUsed: ['BB', 'RSI'],
      }
    }
    return holdResult(`BB% ${(bbPct*100).toFixed(0)}% — in range`, ['BB'])
  },
}
