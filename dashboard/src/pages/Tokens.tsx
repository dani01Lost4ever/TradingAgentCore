import { useEffect, useState, useCallback } from 'react'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, Cell,
} from 'recharts'
import { api } from '../api'
import type { TokenStats, TokenUsageRow } from '../api'

const TOOLTIP_STYLE = {
  background: 'var(--bg3)', border: '1px solid var(--border2)',
  borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)',
}

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

function fmtModel(m: string): string {
  // Shorten model name for display
  return m
    .replace('claude-', '')
    .replace('-20250514', '')
    .replace('-20241022', '')
    .replace('-20240229', '')
}

function StatBox({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--border)',
      borderRadius: 8, padding: '16px 20px',
    }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 8 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700, color: accent ? `var(--${accent})` : 'var(--text)' }}>
        {value}
      </div>
      {sub && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export function Tokens() {
  const [stats, setStats]     = useState<TokenStats | null>(null)
  const [history, setHistory] = useState<TokenUsageRow[]>([])
  const [activeWalletName, setActiveWalletName] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const walletsRes = await api.wallets()
      const activeWallet = walletsRes.wallets.find(w => w.active)
      const activeWalletId = activeWallet?.id
      const [s, h] = await Promise.all([
        api.tokenStats(activeWalletId),
        api.tokenHistory(300, activeWalletId),
      ])
      setStats(s)
      setHistory(h)
      setActiveWalletName(activeWallet?.name || '')
      setError(null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
      <span style={{ animation: 'pulse 1.2s ease infinite' }}>LOADING TOKEN DATA...</span>
    </div>
  )

  if (error) return (
    <div style={{ padding: 40, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--danger)' }}>
      Error: {error}
    </div>
  )

  if (!stats) return null

  // ── Cumulative cost series from raw history ────────────────────────────────
  const cumulativeSeries = history.reduce<{ ts: string; cumCost: number; cost: number }[]>((acc, row) => {
    const prev = acc.length ? acc[acc.length - 1].cumCost : 0
    acc.push({
      ts: new Date(row.ts).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      cost: row.cost_usd,
      cumCost: parseFloat((prev + row.cost_usd).toFixed(6)),
    })
    return acc
  }, [])

  // ── Daily cost bar data ────────────────────────────────────────────────────
  const dailyData = stats.daily.map(d => ({
    date: d.date.slice(5),   // MM-DD
    cost: d.cost_usd,
    calls: d.calls,
    tokens: d.input_tokens + d.output_tokens,
  }))

  // ── Per-call history table (latest 50) ────────────────────────────────────
  const recent = [...history].reverse().slice(0, 50)

  // Total tokens
  const totalTokens = stats.total_input + stats.total_output
  const avgCostPerCall = stats.total_calls > 0
    ? (stats.total_cost / stats.total_calls).toFixed(4)
    : '0.0000'

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 28 }}>
        <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--accent)' }}>
          API COST MONITOR
        </h1>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
          {activeWalletName ? `Wallet: ${activeWalletName} | ` : ''}Anthropic Claude all figures are estimates based on published token pricing
        </span>
        <button
          onClick={load}
          style={{ marginLeft: 'auto', padding: '5px 14px', borderRadius: 4, border: '1px solid var(--border2)', background: 'var(--bg3)', color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer' }}
        >
          ↺ Refresh
        </button>
      </div>

      {/* ── Stat row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(175px,1fr))', gap: 12, marginBottom: 28 }}>
        <StatBox label="TOTAL COST" value={`$${stats.total_cost.toFixed(4)}`} accent="warn" sub="since agent start" />
        <StatBox label="TOTAL CALLS" value={stats.total_calls.toLocaleString()} sub={`avg $${avgCostPerCall} / call`} />
        <StatBox label="INPUT TOKENS" value={fmtTokens(stats.total_input)} sub="prompt tokens" />
        <StatBox label="OUTPUT TOKENS" value={fmtTokens(stats.total_output)} sub="completion tokens" />
        <StatBox label="TOTAL TOKENS" value={fmtTokens(totalTokens)} accent="accent" />
      </div>

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>

        {/* Cumulative cost curve */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 14 }}>
            CUMULATIVE COST (USD)
          </div>
          {cumulativeSeries.length > 1 ? (
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={cumulativeSeries} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <defs>
                  <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--warn)" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="var(--warn)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="ts" tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(3)}`} width={60} />
                <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: any) => [`$${Number(v).toFixed(5)}`, 'Cumulative cost']} labelStyle={{ color: 'var(--muted)' }} />
                <Area type="monotone" dataKey="cumCost" stroke="var(--warn)" strokeWidth={1.5} fill="url(#costGrad)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
              No data yet — waiting for first agent cycle
            </div>
          )}
        </div>

        {/* Daily cost bars */}
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 14 }}>
            DAILY COST — LAST 30 DAYS (USD)
          </div>
          {dailyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={dailyData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="date" tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toFixed(3)}`} width={60} />
                <Tooltip
                  contentStyle={TOOLTIP_STYLE}
                  formatter={(v: any, name: string) => {
                    if (name === 'cost') return [`$${Number(v).toFixed(4)}`, 'Cost']
                    if (name === 'calls') return [v, 'Calls']
                    return [fmtTokens(Number(v)), 'Tokens']
                  }}
                  labelStyle={{ color: 'var(--muted)' }}
                />
                <Bar dataKey="cost" radius={[3, 3, 0, 0]}>
                  {dailyData.map((_, i) => (
                    <Cell key={i} fill="var(--accent)" fillOpacity={0.75} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div style={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
              No daily data yet
            </div>
          )}
        </div>
      </div>

      {/* ── Model breakdown ── */}
      {stats.by_model.length > 0 && (
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden', marginBottom: 28 }}>
          <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em' }}>
            BY MODEL
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Model', 'Calls', 'Input tokens', 'Output tokens', 'Total tokens', 'Cost (USD)', '% of total'].map(h => (
                    <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stats.by_model.map((m, i) => {
                  const pct = stats.total_cost > 0 ? ((m.cost_usd / stats.total_cost) * 100).toFixed(1) : '0'
                  const barW = stats.total_cost > 0 ? (m.cost_usd / stats.total_cost) * 100 : 0
                  return (
                    <tr key={m.model} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>
                        {fmtModel(m.model)}
                      </td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{m.calls.toLocaleString()}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{fmtTokens(m.input_tokens)}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{fmtTokens(m.output_tokens)}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12 }}>{fmtTokens(m.input_tokens + m.output_tokens)}</td>
                      <td style={{ padding: '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)', fontWeight: 600 }}>
                        ${m.cost_usd.toFixed(4)}
                      </td>
                      <td style={{ padding: '10px 16px', minWidth: 120 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 4, background: 'var(--bg3)', borderRadius: 2, overflow: 'hidden' }}>
                            <div style={{ width: `${barW}%`, height: '100%', background: 'var(--warn)', borderRadius: 2 }} />
                          </div>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', minWidth: 32 }}>{pct}%</span>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Per-call log ── */}
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em' }}>
          RECENT API CALLS (last {recent.length})
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Time', 'Model', 'Context', 'Input', 'Output', 'Total', 'Cost'].map(h => (
                  <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', fontWeight: 400, whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.map((row, i) => (
                <tr key={row._id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                    {new Date(row.ts).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </td>
                  <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{fmtModel(row.llm_model)}</td>
                  <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>{row.context}</td>
                  <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.input_tokens.toLocaleString()}</td>
                  <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{row.output_tokens.toLocaleString()}</td>
                  <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{(row.input_tokens + row.output_tokens).toLocaleString()}</td>
                  <td style={{ padding: '8px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--warn)' }}>
                    ${row.cost_usd.toFixed(5)}
                  </td>
                </tr>
              ))}
              {recent.length === 0 && (
                <tr><td colSpan={7} style={{ padding: '40px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
                  No API calls recorded yet — waiting for first agent cycle
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

    </div>
  )
}

