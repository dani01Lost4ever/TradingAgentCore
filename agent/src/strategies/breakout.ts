import type { StrategyMeta, StrategyContext, ResolvedParams, StrategyResult } from './types'
import { holdResult } from './types'
import { computeAtrPositionSize } from '../risk'

export const breakout: StrategyMeta = {
  id: 'breakout',
  label: 'Breakout (Volume)',
  description: 'Buys on price breaking above upper Bollinger Band with volume spike. Momentum entry.',
  params: [
    { key: 'bbBreakout',     label: 'BB% breakout threshold', type: 'number', default: 0.95, min: 0.8, max: 1.2, step: 0.01, gridValues: [0.90, 0.95, 1.00] },
    { key: 'volMultiplier',  label: 'Volume multiplier',      type: 'number', default: 1.5,  min: 1.0, max: 4.0, step: 0.1,  gridValues: [1.2, 1.5, 2.0] },
    { key: 'rsiMaxBuy',      label: 'Max RSI to buy',         type: 'number', default: 75,   min: 60,  max: 90,  step: 1,    gridValues: [70, 75, 80] },
    { key: 'rsiSell',        label: 'RSI sell threshold',     type: 'number', default: 75,   min: 60,  max: 90,  step: 1 },
  ],
  evaluate: async (ctx: StrategyContext, p: ResolvedParams): Promise<StrategyResult> => {
    const { snapshot: s, maxPositionUsd } = ctx
    const bbPct = s.bb_pct
    const rsi   = s.rsi_14 ?? 50
    const amt   = computeAtrPositionSize(s.atr_14, s.price, maxPositionUsd)
    const volRatio = s.volume_sma20 && s.volume_sma20 > 0
      ? (s.volume_24h / 24) / s.volume_sma20
      : 1.0

    if (bbPct != null && bbPct > (p.bbBreakout as number)
      && volRatio >= (p.volMultiplier as number)
      && rsi < (p.rsiMaxBuy as number)) {
      const conf = Math.min(0.90, 0.60 + (bbPct - (p.bbBreakout as number)) + (volRatio - (p.volMultiplier as number)) * 0.1)
      return {
        action: 'buy', confidence: conf, amount_usd: amt,
        reasoning: `Breakout: BB% ${(bbPct*100).toFixed(0)}%, vol ${volRatio.toFixed(2)}x SMA20`,
        signal: conf >= 0.75 ? 'strong' : 'moderate',
        indicatorsUsed: ['BB', 'Volume'],
      }
    }
    // Exit: RSI overbought or BB% collapses
    if (rsi > (p.rsiSell as number) || (bbPct != null && bbPct < 0.5)) {
      return {
        action: 'sell', confidence: 0.70, amount_usd: amt,
        reasoning: `Breakout exit: RSI ${rsi.toFixed(0)}, BB% ${bbPct != null ? (bbPct*100).toFixed(0) : 'N/A'}%`,
        signal: 'moderate', indicatorsUsed: ['BB', 'RSI'],
      }
    }
    return holdResult('No breakout signal', ['BB', 'Volume'])
  },
}
