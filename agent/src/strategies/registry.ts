import { momentum }       from './momentum'
import { meanReversion }  from './meanReversion'
import { breakout }       from './breakout'
import { trendFollowing } from './trendFollowing'
import { autoSelector }   from './autoSelector'
import type { StrategyMeta, ParamDef, ResolvedParams } from './types'

// LLM strategy is registered lazily to avoid circular import with brain.ts
let _llmStrategy: StrategyMeta | null = null
export function registerLlmStrategy(s: StrategyMeta) { _llmStrategy = s }

const REGISTRY: Record<string, StrategyMeta> = {
  [momentum.id]:       momentum,
  [meanReversion.id]:  meanReversion,
  [breakout.id]:       breakout,
  [trendFollowing.id]: trendFollowing,
  [autoSelector.id]:   autoSelector,
}

export function getStrategy(id: string): StrategyMeta {
  if (id === 'llm') {
    if (!_llmStrategy) throw new Error('LLM strategy not registered')
    return _llmStrategy
  }
  const s = REGISTRY[id]
  if (!s) throw new Error(`Unknown strategy: "${id}"`)
  return s
}

export function listStrategies(): Omit<StrategyMeta, 'evaluate'>[] {
  const all = Object.values(REGISTRY).map(({ evaluate: _, ...meta }) => meta)
  if (_llmStrategy) {
    const { evaluate: _, ...meta } = _llmStrategy
    all.push(meta)
  }
  return all
}

export function mergeWithDefaults(defs: ParamDef[], overrides: ResolvedParams): ResolvedParams {
  const out: ResolvedParams = {}
  for (const d of defs) out[d.key] = d.default
  for (const [k, v] of Object.entries(overrides)) {
    if (k in out) out[k] = v
  }
  return out
}
