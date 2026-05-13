/**
 * costs.ts — pure cost/tax math for broker fees and capital-gains tax.
 * No I/O, no DB calls. All functions are deterministic and easily unit-testable.
 */

export interface FeeModel {
  kind: 'percent' | 'flat'
  value: number    // percent (e.g. 0.6 = 0.6%) OR flat USD per side
  minFee: number   // floor in USD per side
}

/**
 * One side's fee in USD given the notional and the fee model.
 * For percent: fee = max(notional * value/100, minFee)
 * For flat:    fee = max(value, minFee)
 */
export function estimateOneSideFee(notional: number, fm: FeeModel): number {
  if (fm.kind === 'percent') {
    return Math.max((notional * fm.value) / 100, fm.minFee ?? 0)
  }
  // flat
  return Math.max(fm.value, fm.minFee ?? 0)
}

/**
 * Round-trip (buy + sell) fee in USD.
 * Entry notional ≈ exit notional for fee purposes (conservative: use entry for both sides).
 */
export function estimateRoundTripFee(notional: number, fm: FeeModel): number {
  return estimateOneSideFee(notional, fm) * 2
}

/**
 * Tax in USD on a realized gain.
 * Negative gains yield 0 — no tax credit modelled (conservative).
 */
export function estimateTaxOnGain(gainUsd: number, taxRatePct: number): number {
  if (gainUsd <= 0) return 0
  return gainUsd * (taxRatePct / 100)
}

/**
 * Compute net P&L for a completed round-trip trade.
 *
 * grossPnl = exitNotional - entryNotional
 * fees     = round-trip broker fees (buy side + sell side)
 * tax      = capital gains tax on max(grossPnl - fees, 0)
 * netPnl   = grossPnl - fees - tax
 */
export function computeNetPnL(args: {
  entryNotional: number
  exitNotional: number
  feeModel: FeeModel
  taxRatePct: number
}): { grossPnl: number; fees: number; tax: number; netPnl: number } {
  const { entryNotional, exitNotional, feeModel, taxRatePct } = args
  const grossPnl = exitNotional - entryNotional
  const fees = estimateRoundTripFee(entryNotional, feeModel)
  // Tax applies only to gain net-of-fees (i.e. the truly realised gain)
  const taxableGain = Math.max(grossPnl - fees, 0)
  const tax = estimateTaxOnGain(taxableGain, taxRatePct)
  const netPnl = grossPnl - fees - tax
  return { grossPnl, fees, tax, netPnl }
}

/**
 * Pre-trade filter: should we proceed given the expected gross return?
 *
 * expectedReturnPct is a gross percentage (e.g. 0.5 = 0.5% expected gain).
 * We compute the expected net and compare it against minNetProfitPct.
 *
 * Returns { ok, reason, expectedNetPct }.
 */
export function shouldTradeNet(args: {
  notional: number
  expectedReturnPct: number   // gross, e.g. 0.5 = 0.5%
  feeModel: FeeModel
  taxRatePct: number
  minNetProfitPct: number
}): { ok: boolean; reason: string; expectedNetPct: number } {
  const { notional, expectedReturnPct, feeModel, taxRatePct, minNetProfitPct } = args

  // Expected gross P&L in USD
  const expectedGrossUsd = notional * (expectedReturnPct / 100)
  const fees = estimateRoundTripFee(notional, feeModel)
  const taxableGain = Math.max(expectedGrossUsd - fees, 0)
  const tax = estimateTaxOnGain(taxableGain, taxRatePct)
  const expectedNetUsd = expectedGrossUsd - fees - tax
  const expectedNetPct = notional > 0 ? (expectedNetUsd / notional) * 100 : 0

  if (expectedNetPct < minNetProfitPct) {
    const feesPct = notional > 0 ? (fees / notional) * 100 : 0
    const taxPct = notional > 0 ? (tax / notional) * 100 : 0
    return {
      ok: false,
      reason: `Expected net ${expectedNetPct.toFixed(3)}% below minimum ${minNetProfitPct}% ` +
              `(gross ${expectedReturnPct.toFixed(3)}% - fees ${feesPct.toFixed(3)}% - tax ${taxPct.toFixed(3)}%)`,
      expectedNetPct,
    }
  }

  return {
    ok: true,
    reason: `Expected net ${expectedNetPct.toFixed(3)}% meets minimum ${minNetProfitPct}%`,
    expectedNetPct,
  }
}
