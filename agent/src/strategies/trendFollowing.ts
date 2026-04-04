import type { StrategyMeta, StrategyContext, ResolvedParams, StrategyResult } from './types'
import { holdResult } from './types'
import { computeAtrPositionSize } from '../risk'

export const trendFollowing: StrategyMeta = {
  id: 'trendFollowing',
  label: 'Trend Following (EMA)',
  description: 'Follows the trend via EMA crossovers. Uses SMA50 as macro filter.',
  params: [
    { key: 'sma50Filter',     label: 'SMA50 filter',      type: 'boolean', default: true,  help: 'Only buy above SMA50, only sell below' },
    { key: 'macdConfirm',     label: 'MACD confirm',      type: 'boolean', default: true,  help: 'Require MACD hist > 0 for buys' },
    { key: 'sma50Buffer',     label: 'SMA50 buffer %',    type: 'number',  default: 1.0, min: 0, max: 5, step: 0.5, help: 'Price must be this % above SMA50 to buy' },
    { key: 'emaCrossBuffer',  label: 'EMA cross buffer %', type: 'number', default: 0.1, min: 0, max: 2, step: 0.1 },
  ],
  evaluate: async (ctx: StrategyContext, p: ResolvedParams): Promise<StrategyResult> => {
    const { snapshot: s, maxPositionUsd } = ctx
    const ema9  = s.ema_9
    const ema21 = s.ema_21
    const sma50 = s.daily_sma50
    const macdH = s.macd_hist
    const amt   = computeAtrPositionSize(s.atr_14, s.price, maxPositionUsd)

    if (!ema9 || !ema21) return holdResult('EMA data unavailable', ['EMA9', 'EMA21'])

    const emaBullish = ema9 > ema21 * (1 + (p.emaCrossBuffer as number) / 100)
    const emaBearish = ema9 < ema21 * (1 - (p.emaCrossBuffer as number) / 100)
    const macdOk     = !p.macdConfirm || (macdH != null && macdH > 0)
    const sma50ok_buy  = !p.sma50Filter || !sma50 || s.price > sma50 * (1 + (p.sma50Buffer as number) / 100)
    const sma50ok_sell = !p.sma50Filter || !sma50 || s.price < sma50

    if (emaBullish && macdOk && sma50ok_buy) {
      const conf = 0.65 + (macdH != null && macdH > 0 ? Math.min(0.20, macdH * 2) : 0)
      return {
        action: 'buy', confidence: Math.min(0.90, conf), amount_usd: amt,
        reasoning: `EMA9 > EMA21 uptrend${sma50 ? `, above SMA50` : ''}`,
        signal: conf >= 0.75 ? 'strong' : 'moderate',
        indicatorsUsed: ['EMA9', 'EMA21', 'MACD', 'SMA50'],
      }
    }
    if (emaBearish && sma50ok_sell) {
      return {
        action: 'sell', confidence: 0.68, amount_usd: amt,
        reasoning: `EMA9 < EMA21 downtrend`,
        signal: 'moderate', indicatorsUsed: ['EMA9', 'EMA21'],
      }
    }
    return holdResult('EMA trend unclear', ['EMA9', 'EMA21'])
  },
}
