import type { StrategyMeta, StrategyContext, ResolvedParams, StrategyResult } from './types'
import { holdResult } from './types'
import { momentum }       from './momentum'
import { meanReversion }  from './meanReversion'
import { breakout }       from './breakout'
import { trendFollowing } from './trendFollowing'

function selectForRegime(regime: string, fearGreed: number | null): StrategyMeta {
  // Fear/Greed extremes override regime
  if (fearGreed !== null) {
    if (fearGreed > 80) return meanReversion   // extreme greed → fade the top
    if (fearGreed < 20) return momentum         // extreme fear → contrarian buy RSI
  }
  if (regime.includes('Bull'))  return trendFollowing
  if (regime.includes('Bear'))  return meanReversion
  return breakout  // Sideways / Unknown → wait for breakout
}

export const autoSelector: StrategyMeta = {
  id: 'auto',
  label: 'Auto (Regime-based)',
  description: 'Selects strategy based on market regime and Fear & Greed index each cycle.',
  params: [],
  evaluate: async (ctx: StrategyContext, _params: ResolvedParams): Promise<StrategyResult> => {
    const chosen = selectForRegime(ctx.regime, ctx.fearGreedValue)
    const result = await chosen.evaluate(ctx, chosen.params.reduce<ResolvedParams>((acc, d) => {
      acc[d.key] = d.default; return acc
    }, {}))
    // Embed which strategy was chosen in the reasoning
    return {
      ...result,
      reasoning: `[Auto→${chosen.label}] ${result.reasoning}`,
    }
  },
}
