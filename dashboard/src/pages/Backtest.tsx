import { useState, useEffect } from 'react'
import { api } from '../api'
import type { BacktestResult, BacktestTrade } from '../api'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

const card: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '20px 24px',
}

const label: React.CSSProperties = {
  fontSize: 10, fontFamily: 'var(--font-mono)', letterSpacing: '0.08em',
  color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 6, display: 'block',
}

const input: React.CSSProperties = {
  width: '100%', padding: '8px 12px', boxSizing: 'border-box',
  background: 'var(--input-bg)', border: '1px solid var(--border)',
  borderRadius: 6, color: 'var(--text)', fontSize: 13,
  fontFamily: 'var(--font-mono)',
}

const btn = (primary = false): React.CSSProperties => ({
  padding: '9px 20px', borderRadius: 6, fontSize: 12,
  fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
  border: '1px solid var(--border)', cursor: 'pointer',
  background: primary ? 'var(--accent)' : 'var(--card)',
  color: primary ? '#000' : 'var(--text)',
  fontWeight: primary ? 600 : 400,
})

function StatCard({ label: lbl, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...card, minWidth: 130, flex: 1 }}>
      <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 6 }}>{lbl}</div>
      <div style={{ fontSize: 22, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

function buildEquityCurve(result: BacktestResult) {
  let equity = result.startEquity
  return (result.trades || []).map(t => {
    equity += t.pnl_usd
    return { ts: new Date(t.ts).toLocaleDateString(), equity: Math.round(equity) }
  })
}

export function Backtest() {
  const [assets, setAssets] = useState('BTC/USD,ETH/USD')
  const [startDate, setStartDate] = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth() - 3)
    return d.toISOString().slice(0, 10)
  })
  const [endDate, setEndDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [cycleHours, setCycleHours] = useState(4)
  const [mode, setMode] = useState<'rules' | 'llm'>('rules')
  const [model, setModel] = useState('')
  const [startEquity, setStartEquity] = useState(10000)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pastRuns, setPastRuns] = useState<BacktestResult[]>([])
  const [selectedPast, setSelectedPast] = useState<BacktestResult | null>(null)
  const [expandedTrades, setExpandedTrades] = useState(false)

  useEffect(() => {
    api.backtestResults().then(setPastRuns).catch(() => {})
  }, [])

  async function run() {
    setRunning(true)
    setError(null)
    setResult(null)
    try {
      const res = await api.runBacktest({
        assets: assets.split(',').map(a => a.trim()).filter(Boolean),
        startDate, endDate,
        cycleHours: Number(cycleHours),
        mode, model,
        startEquity: Number(startEquity),
      })
      setResult(res)
      api.backtestResults().then(setPastRuns).catch(() => {})
    } catch (e: any) {
      setError(e.message || 'Backtest failed')
    } finally {
      setRunning(false)
    }
  }

  const display = selectedPast || result

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 28px', fontFamily: 'var(--font-mono)', fontSize: 16, letterSpacing: '0.08em', color: 'var(--text)' }}>
        BACKTEST
      </h2>

      {/* Config form */}
      <div style={{ ...card, marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div>
            <span style={label}>Assets (comma-separated)</span>
            <input style={input} value={assets} onChange={e => setAssets(e.target.value)} />
          </div>
          <div>
            <span style={label}>Start date</span>
            <input style={input} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div>
            <span style={label}>End date</span>
            <input style={input} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div>
            <span style={label}>Cycle (hours)</span>
            <input style={input} type="number" min={1} max={24} value={cycleHours}
              onChange={e => setCycleHours(Number(e.target.value))} />
          </div>
          <div>
            <span style={label}>Start equity ($)</span>
            <input style={input} type="number" min={100} value={startEquity}
              onChange={e => setStartEquity(Number(e.target.value))} />
          </div>
          <div>
            <span style={label}>Model (LLM mode)</span>
            <input style={input} placeholder="e.g. claude-haiku-4-5-20251001" value={model}
              onChange={e => setModel(e.target.value)} />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={label}>Mode</span>
          {(['rules', 'llm'] as const).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              ...btn(mode === m), padding: '6px 16px', fontSize: 11,
            }}>{m.toUpperCase()}</button>
          ))}
          <button onClick={run} disabled={running} style={{ ...btn(true), marginLeft: 'auto', opacity: running ? 0.6 : 1 }}>
            {running ? 'Running…' : 'Run Backtest'}
          </button>
        </div>

        {error && (
          <div style={{ marginTop: 12, color: 'var(--danger)', fontSize: 12, fontFamily: 'var(--font-mono)' }}>{error}</div>
        )}
      </div>

      {/* Results */}
      {display && (() => {
        const curve = buildEquityCurve(display)
        const ret = display.totalReturn * 100
        const retColor = ret >= 0 ? 'var(--green)' : 'var(--danger)'
        const trades: BacktestTrade[] = display.trades || []

        return (
          <div style={{ marginBottom: 24 }}>
            {selectedPast && (
              <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
                Past run: {new Date(selectedPast.runAt).toLocaleString()} —{' '}
                {selectedPast.params.assets.join(', ')} — {selectedPast.params.mode}
                {' '}
                <button onClick={() => setSelectedPast(null)} style={{ ...btn(), padding: '2px 10px', fontSize: 10 }}>Clear</button>
              </div>
            )}

            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 20 }}>
              <StatCard label="Total return" value={`${ret.toFixed(2)}%`}
                sub={`$${display.startEquity.toLocaleString()} → $${Math.round(display.finalEquity).toLocaleString()}`} />
              <StatCard label="Max drawdown" value={`${(display.maxDrawdown * 100).toFixed(2)}%`} />
              <StatCard label="Win rate" value={`${(display.winRate * 100).toFixed(1)}%`} />
              <StatCard label="Total trades" value={String(display.totalTrades)} />
              {display.sharpe != null && (
                <StatCard label="Sharpe ratio" value={display.sharpe.toFixed(2)} sub="annualized" />
              )}
              {display.sortino != null && (
                <StatCard label="Sortino ratio" value={display.sortino.toFixed(2)} sub="annualized" />
              )}
            </div>

            {curve.length > 1 && (
              <div style={{ ...card, marginBottom: 20 }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>EQUITY CURVE</div>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={curve}>
                    <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                    <XAxis dataKey="ts" tick={{ fill: 'var(--muted)', fontSize: 10 }} tickLine={false} />
                    <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }} tickLine={false} width={70}
                      tickFormatter={v => `$${v.toLocaleString()}`} />
                    <Tooltip
                      contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 11 }}
                      formatter={(v: number) => [`$${v.toLocaleString()}`, 'Equity']}
                    />
                    <Line dataKey="equity" stroke={retColor} dot={false} strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {trades.length > 0 && (
              <div style={card}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>TRADE LOG ({trades.length})</div>
                  <button onClick={() => setExpandedTrades(x => !x)} style={{ ...btn(), padding: '4px 12px', fontSize: 10 }}>
                    {expandedTrades ? 'Collapse' : 'Expand'}
                  </button>
                </div>
                {expandedTrades && (
                  <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                      <thead>
                        <tr style={{ color: 'var(--muted)' }}>
                          {['Date', 'Asset', 'Action', 'Price', 'Amount', 'PnL'].map(h => (
                            <th key={h} style={{ textAlign: 'left', padding: '4px 10px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {trades.slice(0, 200).map((t, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid var(--border2)' }}>
                            <td style={{ padding: '4px 10px' }}>{new Date(t.ts).toLocaleDateString()}</td>
                            <td style={{ padding: '4px 10px' }}>{t.asset.replace('/USD', '')}</td>
                            <td style={{ padding: '4px 10px', color: t.action === 'buy' ? 'var(--green)' : t.action === 'sell' ? 'var(--danger)' : 'var(--muted)' }}>
                              {t.action.toUpperCase()}
                            </td>
                            <td style={{ padding: '4px 10px' }}>${t.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                            <td style={{ padding: '4px 10px' }}>${t.amount_usd.toFixed(0)}</td>
                            <td style={{ padding: '4px 10px', color: t.pnl_usd >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                              {t.pnl_usd >= 0 ? '+' : ''}{t.pnl_usd.toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {trades.length > 200 && (
                      <div style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 11 }}>… {trades.length - 200} more rows hidden</div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })()}

      {/* Past runs */}
      {pastRuns.length > 0 && (
        <div style={card}>
          <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>PAST RUNS</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ color: 'var(--muted)' }}>
                  {['Date', 'Assets', 'Mode', 'Return', 'Max DD', 'Win Rate', 'Trades', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '4px 10px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pastRuns.map((r, i) => {
                  const ret = (r.totalReturn * 100).toFixed(2)
                  const positive = r.totalReturn >= 0
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border2)' }}>
                      <td style={{ padding: '4px 10px' }}>{new Date(r.runAt).toLocaleString()}</td>
                      <td style={{ padding: '4px 10px' }}>{r.params.assets.map(a => a.replace('/USD', '')).join(', ')}</td>
                      <td style={{ padding: '4px 10px' }}>{r.params.mode}</td>
                      <td style={{ padding: '4px 10px', color: positive ? 'var(--green)' : 'var(--danger)' }}>
                        {positive ? '+' : ''}{ret}%
                      </td>
                      <td style={{ padding: '4px 10px' }}>{(r.maxDrawdown * 100).toFixed(2)}%</td>
                      <td style={{ padding: '4px 10px' }}>{(r.winRate * 100).toFixed(1)}%</td>
                      <td style={{ padding: '4px 10px' }}>{r.totalTrades}</td>
                      <td style={{ padding: '4px 10px' }}>
                        <button onClick={() => { setSelectedPast(r); setResult(null) }}
                          style={{ ...btn(), padding: '2px 10px', fontSize: 10 }}>View</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
