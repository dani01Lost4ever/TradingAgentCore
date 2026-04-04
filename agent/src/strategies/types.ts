import type { AssetSnapshot } from '../schema'
import type { Portfolio } from '../poller'

export interface ParamDef {
  key: string
  label: string
  type: 'number' | 'boolean' | 'select'
  default: number | boolean | string
  min?: number; max?: number; step?: number
  options?: string[]
  gridValues?: (number | boolean | string)[]
  help?: string
}

export type ResolvedParams = Record<string, number | boolean | string>

export type SignalStrength = 'strong' | 'moderate' | 'weak' | 'none'

export interface StrategyContext {
  asset: string
  snapshot: AssetSnapshot
  portfolio: Portfolio
  maxPositionUsd: number
  regime: string
  fearGreedValue: number | null
}

export interface StrategyResult {
  action: 'buy' | 'sell' | 'hold'
  confidence: number
  amount_usd: number
  reasoning: string
  signal: SignalStrength
  indicatorsUsed: string[]
}

export interface StrategyMeta {
  id: string
  label: string
  description: string
  params: ParamDef[]
  evaluate: (ctx: StrategyContext, params: ResolvedParams) => Promise<StrategyResult>
}

export function mergeWithDefaults(defs: ParamDef[], overrides: ResolvedParams): ResolvedParams {
  const out: ResolvedParams = {}
  for (const d of defs) out[d.key] = d.default
  for (const [k, v] of Object.entries(overrides)) {
    if (k in out) out[k] = v
  }
  return out
}

export function holdResult(reasoning = 'No signal', indicators: string[] = []): StrategyResult {
  return { action: 'hold', confidence: 0.5, amount_usd: 0, reasoning, signal: 'none', indicatorsUsed: indicators }
}

// cartesian product helper for optimizer
export function cartesianProduct<T>(arrays: T[][]): T[][] {
  return arrays.reduce<T[][]>(
    (acc, arr) => acc.flatMap(combo => arr.map(v => [...combo, v])),
    [[]]
  )
}
