// ─── Shared technical-indicator helpers ──────────────────────────────────────
// Extracted from alpaca.ts so all exchange adapters can share the same logic.

/** EMA over an array of values. Returns array aligned to the tail. */
export function computeEMA(values: number[], period: number): number[] {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  // Seed with SMA of the first `period` values
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  const result = [ema]
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k)
    result.push(ema)
  }
  return result
}

/** Classic RSI(period) from closing prices. Returns 50 when insufficient data. */
export function computeRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50

  let gains = 0
  let losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }

  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100

  const rs = avgGain / avgLoss
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2))
}

/** MACD(12,26,9): returns line, signal, and histogram. */
export function computeMACD(
  closes: number[]
): { macd: number; signal: number; hist: number } | null {
  const ema12 = computeEMA(closes, 12)
  const ema26 = computeEMA(closes, 26)
  if (!ema12.length || !ema26.length) return null

  // Align ema12 to ema26 — ema26 is shorter by (26-12)=14 items
  const offset = ema12.length - ema26.length
  const macdLine = ema26.map((v, i) => ema12[i + offset] - v)

  const signalLine = computeEMA(macdLine, 9)
  if (!signalLine.length) return null

  const lastMacd   = macdLine[macdLine.length - 1]
  const lastSignal = signalLine[signalLine.length - 1]

  return {
    macd:   parseFloat(lastMacd.toFixed(6)),
    signal: parseFloat(lastSignal.toFixed(6)),
    hist:   parseFloat((lastMacd - lastSignal).toFixed(6)),
  }
}

/** Bollinger Bands(20, 2σ): upper, lower, and %B (0=lower, 1=upper). */
export function computeBollingerBands(
  closes: number[],
  period = 20
): { upper: number; lower: number; pct: number } | null {
  if (closes.length < period) return null
  const slice    = closes.slice(-period)
  const sma      = slice.reduce((a, b) => a + b, 0) / period
  const variance = slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period
  const sd       = Math.sqrt(variance)
  const upper    = sma + 2 * sd
  const lower    = sma - 2 * sd
  const price    = closes[closes.length - 1]
  const pct      = upper === lower ? 0.5 : (price - lower) / (upper - lower)

  return {
    upper: parseFloat(upper.toFixed(6)),
    lower: parseFloat(lower.toFixed(6)),
    pct:   parseFloat(pct.toFixed(3)),
  }
}

/** ATR(14): average true range using EMA smoothing. */
export function computeATR(bars: Array<{ h: number; l: number; c: number }>, period = 14): number | null {
  if (bars.length < period + 1) return null
  const trValues: number[] = []
  for (let i = 1; i < bars.length; i++) {
    trValues.push(Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    ))
  }
  const atrArr = computeEMA(trValues, period)
  if (!atrArr.length) return null
  return parseFloat(atrArr[atrArr.length - 1].toFixed(6))
}
