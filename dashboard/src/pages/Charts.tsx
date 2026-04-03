import { useEffect, useState, useCallback } from 'react'
import {
  ComposedChart, Area, Line, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from 'recharts'
import { api } from '../api'
import type { OHLCBar } from '../api'

type Timeframe = '15Min' | '1H' | '4H' | '1D'
const TIMEFRAMES: { id: Timeframe; label: string }[] = [
  { id: '15Min', label: '15m' },
  { id: '1H',    label: '1H'  },
  { id: '4H',    label: '4H'  },
  { id: '1D',    label: '1D'  },
]
const TF_LIMIT: Record<Timeframe, number> = {
  '15Min': 200, '1H': 150, '4H': 120, '1D': 180,
}

function computeEMA(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = new Array(values.length).fill(null)
  if (values.length < period) return result
  const k = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  result[period - 1] = ema
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k)
    result[i] = ema
  }
  return result
}

function fmtDate(ts: string, tf: Timeframe) {
  const d = new Date(ts)
  if (tf === '1D') return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
  return d.toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fmtPrice(v: number) {
  if (v >= 1000) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
  if (v >= 1) return `$${v.toFixed(3)}`
  return `$${v.toFixed(6)}`
}

interface ChartPoint {
  date: string
  open: number; high: number; low: number; close: number
  volume: number
  ema9: number | null
  ema21: number | null
  isUp: boolean
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload as ChartPoint
  if (!d) return null
  return (
    <div style={{
      background: 'var(--bg3)', border: '1px solid var(--border2)',
      borderRadius: 6, padding: '10px 14px',
      fontFamily: 'var(--font-mono)', fontSize: 11,
    }}>
      <div style={{ color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', gap: '2px 14px' }}>
        <span style={{ color: 'var(--muted)' }}>O</span><span style={{ color: 'var(--text)' }}>{fmtPrice(d.open)}</span>
        <span style={{ color: 'var(--muted)' }}>H</span><span style={{ color: 'var(--green)' }}>{fmtPrice(d.high)}</span>
        <span style={{ color: 'var(--muted)' }}>L</span><span style={{ color: 'var(--danger)' }}>{fmtPrice(d.low)}</span>
        <span style={{ color: 'var(--muted)' }}>C</span><span style={{ color: d.isUp ? 'var(--green)' : 'var(--danger)', fontWeight: 600 }}>{fmtPrice(d.close)}</span>
        {d.ema9  != null && <><span style={{ color: 'var(--muted)' }}>EMA9</span><span style={{ color: 'var(--accent)' }}>{fmtPrice(d.ema9)}</span></>}
        {d.ema21 != null && <><span style={{ color: 'var(--muted)' }}>EMA21</span><span style={{ color: 'var(--accent2)' }}>{fmtPrice(d.ema21)}</span></>}
        <span style={{ color: 'var(--muted)' }}>Vol</span><span style={{ color: 'var(--text)' }}>{d.volume.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      </div>
    </div>
  )
}

function AssetChart({ asset }: { asset: string }) {
  const [tf, setTf]         = useState<Timeframe>('1H')
  const [data, setData]     = useState<ChartPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]   = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const bars: OHLCBar[] = await api.chartBars(asset, tf, TF_LIMIT[tf])
      const closes = bars.map(b => b.c)
      const ema9arr  = computeEMA(closes, 9)
      const ema21arr = computeEMA(closes, 21)
      const points: ChartPoint[] = bars.map((b, i) => ({
        date:   fmtDate(b.t, tf),
        open:   b.o, high: b.h, low: b.l, close: b.c,
        volume: b.v,
        ema9:   ema9arr[i],
        ema21:  ema21arr[i],
        isUp:   b.c >= b.o,
      }))
      setData(points)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [asset, tf])

  useEffect(() => { load() }, [load])

  const last = data[data.length - 1]
  const first = data[0]
  const overallChange = last && first
    ? ((last.close - first.close) / first.close * 100)
    : null

  // Compute y-axis domain with some padding
  const prices = data.flatMap(d => [d.high, d.low])
  const minP = prices.length ? Math.min(...prices) : 0
  const maxP = prices.length ? Math.max(...prices) : 1
  const padP = (maxP - minP) * 0.04
  const yDomain: [number, number] = [minP - padP, maxP + padP]

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 16 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 18px', borderBottom: '1px solid var(--border)', gap: 12 }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{asset}</span>
        {last && (
          <>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {fmtPrice(last.close)}
            </span>
            {overallChange != null && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: overallChange >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                {overallChange >= 0 ? '+' : ''}{overallChange.toFixed(2)}%
              </span>
            )}
          </>
        )}

        {/* Timeframe selector */}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
          {TIMEFRAMES.map(t => (
            <button
              key={t.id}
              onClick={() => setTf(t.id)}
              style={{
                padding: '4px 10px', borderRadius: 4, fontSize: 11,
                fontFamily: 'var(--font-mono)',
                background: tf === t.id ? 'rgba(var(--accent-rgb,0,212,170),0.12)' : 'transparent',
                color: tf === t.id ? 'var(--accent)' : 'var(--muted)',
                border: tf === t.id ? '1px solid rgba(var(--accent-rgb,0,212,170),0.3)' : '1px solid transparent',
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', animation: 'pulse 1.2s ease infinite' }}>
          Loading…
        </div>
      ) : error ? (
        <div style={{ height: 320, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--danger)' }}>
          ✕ {error}
        </div>
      ) : (
        <div style={{ padding: '12px 0 0' }}>
          {/* Price chart */}
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id={`grad-${asset.replace('/','-')}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="date" tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }}
                axisLine={false} tickLine={false}
                interval={Math.max(1, Math.floor(data.length / 8))}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }}
                axisLine={false} tickLine={false}
                tickFormatter={v => fmtPrice(v)} width={72}
                orientation="right"
              />
              <Tooltip content={<CustomTooltip />} />
              <Area
                type="monotone" dataKey="close"
                stroke="var(--accent)" strokeWidth={1.5}
                fill={`url(#grad-${asset.replace('/','-')})`}
                dot={false} activeDot={{ r: 3, fill: 'var(--accent)' }}
              />
              <Line type="monotone" dataKey="ema9"  stroke="var(--accent)"  strokeWidth={1} dot={false} strokeDasharray="4 2" connectNulls />
              <Line type="monotone" dataKey="ema21" stroke="var(--accent2)" strokeWidth={1} dot={false} strokeDasharray="4 2" connectNulls />
              {last && <ReferenceLine y={last.close} stroke="var(--border2)" strokeDasharray="2 3" />}
            </ComposedChart>
          </ResponsiveContainer>

          {/* Volume chart */}
          <ResponsiveContainer width="100%" height={60}>
            <ComposedChart data={data} margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
              <XAxis dataKey="date" hide />
              <YAxis hide />
              <Bar dataKey="volume" radius={[1, 1, 0, 0]}>
                {data.map((entry, i) => (
                  <rect
                    key={i}
                    fill={entry.isUp ? 'rgba(34,197,94,0.4)' : 'rgba(255,77,109,0.4)'}
                  />
                ))}
              </Bar>
            </ComposedChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div style={{ display: 'flex', gap: 16, padding: '6px 18px 12px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 16, height: 2, background: 'var(--accent)', display: 'inline-block', borderRadius: 1 }} />
              Close
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 16, height: 2, background: 'var(--accent)', display: 'inline-block', borderRadius: 1, opacity: 0.7 }} />
              EMA9
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 16, height: 2, background: 'var(--accent2)', display: 'inline-block', borderRadius: 1, opacity: 0.7 }} />
              EMA21
            </span>
            <span style={{ marginLeft: 'auto' }}>{data.length} bars · {tf}</span>
          </div>
        </div>
      )}
    </div>
  )
}

export function Charts() {
  const [assets, setAssets]   = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.activeAssets()
      .then(setAssets)
      .catch(() => setAssets(['BTC/USD', 'ETH/USD']))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div style={{ padding: '28px', maxWidth: 1100, margin: '0 auto' }}>
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--accent)', marginBottom: 6 }}>
          CHARTS
        </h2>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
          Price, EMA9/21 overlay, and volume for each active asset.
        </p>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', animation: 'pulse 1.2s ease infinite' }}>
          Loading assets…
        </div>
      ) : assets.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
          No active assets. Enable some in the Assets page.
        </div>
      ) : (
        assets.map(asset => <AssetChart key={asset} asset={asset} />)
      )}
    </div>
  )
}
