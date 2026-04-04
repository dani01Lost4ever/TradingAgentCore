import type { StrategyMeta, StrategyContext, ResolvedParams, StrategyResult } from './types'
import { holdResult } from './types'
import { computeAtrPositionSize } from '../risk'

export const momentum: StrategyMeta = {
  id: 'momentum',
  label: 'Momentum (RSI)',
  description: 'Buys when RSI is oversold with volume confirmation; sells when overbought.',
  params: [
    { key: 'rsiOversold',   label: 'RSI Oversold',    type: 'number', default: 35, min: 20, max: 50, step: 1, gridValues: [25, 30, 35, 40] },
    { key: 'rsiOverbought', label: 'RSI Overbought',   type: 'number', default: 65, min: 55, max: 85, step: 1, gridValues: [60, 65, 70, 75] },
    { key: 'minVolRatio',   label: 'Min Volume Ratio', type: 'number', default: 0.8, min: 0.5, max: 3.0, step: 0.1, gridValues: [0.8, 1.0, 1.5], help: 'hourly volume / vol SMA20' },
  ],
  evaluate: async (ctx: StrategyContext, p: ResolvedParams): Promise<StrategyResult> => {
    const { snapshot: s, asset, maxPositionUsd } = ctx
    const rsi = s.rsi_14 ?? 50
    const volRatio = s.volume_sma20 && s.volume_sma20 > 0
      ? (s.volume_24h / 24) / s.volume_sma20
      : 1.0
    const amt = computeAtrPositionSize(s.atr_14, s.price, maxPositionUsd)

    if (rsi < (p.rsiOversold as number) && volRatio >= (p.minVolRatio as number)) {
      const conf = Math.min(0.95, 0.55 + ((p.rsiOversold as number) - rsi) / 40)
      return {
        action: 'buy', confidence: conf, amount_usd: amt,
        reasoning: `RSI ${rsi.toFixed(0)} oversold, vol ratio ${volRatio.toFixed(2)}x`,
        signal: conf >= 0.75 ? 'strong' : 'moderate',
        indicatorsUsed: ['RSI', 'Volume'],
      }
    }
    if (rsi > (p.rsiOverbought as number)) {
      const conf = Math.min(0.95, 0.55 + (rsi - (p.rsiOverbought as number)) / 40)
      return {
        action: 'sell', confidence: conf, amount_usd: amt,
        reasoning: `RSI ${rsi.toFixed(0)} overbought — taking profit`,
        signal: conf >= 0.75 ? 'strong' : 'moderate',
        indicatorsUsed: ['RSI'],
      }
    }
    return holdResult(`RSI neutral at ${rsi.toFixed(0)}`, ['RSI'])
  },
}
