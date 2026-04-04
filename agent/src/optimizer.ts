import { getStrategy, mergeWithDefaults } from './strategies/registry'
import { runBacktest } from './backtest'
import { OptimizeResultModel } from './schema'
import { cartesianProduct } from './strategies/types'
import type { ResolvedParams } from './strategies/types'

export interface OptimizeRequest {
  strategyId: string
  assets: string[]
  startDate: string; endDate: string; cycleHours: number
  startEquity: number; maxPositionUsd: number
  paramGrid: Record<string, (number | boolean | string)[]>
}

export interface OptimizeRun {
  params: ResolvedParams
  sharpe: number; sortino: number; totalReturn: number
  maxDrawdown: number; winRate: number; totalTrades: number
}

export async function runOptimization(req: OptimizeRequest): Promise<{
  strategyId: string
  bestParams: ResolvedParams
  bestSharpe: number
  totalRuns: number
  runs: OptimizeRun[]
}> {
  const strategy = getStrategy(req.strategyId)

  const paramKeys  = Object.keys(req.paramGrid)
  const paramGrid  = paramKeys.map(k => req.paramGrid[k])
  const combos     = cartesianProduct(paramGrid)

  const runs: OptimizeRun[] = []

  for (const combo of combos) {
    const overrides: ResolvedParams = {}
    paramKeys.forEach((k, i) => { overrides[k] = combo[i] })
    const params = mergeWithDefaults(strategy.params, overrides)

    try {
      const bt = await runBacktest({
        assets:         req.assets,
        startDate:      req.startDate,
        endDate:        req.endDate,
        cycleHours:     req.cycleHours,
        strategyId:     req.strategyId,
        strategyParams: params,
        startEquity:    req.startEquity,
        maxPositionUsd: req.maxPositionUsd,
        model:          '',
        mode:           'rules',
        saveToDb:       false,
      })
      runs.push({
        params,
        sharpe:      bt.sharpe ?? 0,
        sortino:     bt.sortino ?? 0,
        totalReturn: bt.totalReturn,
        maxDrawdown: bt.maxDrawdown,
        winRate:     bt.winRate,
        totalTrades: bt.totalTrades,
      })
    } catch (e: any) {
      console.warn(`[optimizer] Combo failed: ${e.message}`)
    }
  }

  runs.sort((a, b) => b.sharpe - a.sharpe || b.totalReturn - a.totalReturn)

  const result = {
    strategyId: req.strategyId,
    bestParams: runs[0]?.params ?? {},
    bestSharpe: runs[0]?.sharpe ?? 0,
    totalRuns:  runs.length,
    runs,
  }

  // Save to DB
  try {
    await OptimizeResultModel.create({
      strategyId: req.strategyId,
      assets: req.assets,
      dateRange: { start: req.startDate, end: req.endDate },
      bestParams: result.bestParams,
      bestSharpe: result.bestSharpe,
      totalRuns: result.totalRuns,
      runs,
    })
  } catch (e: any) { console.warn('[optimizer] Failed to save result:', e.message) }

  return result
}
