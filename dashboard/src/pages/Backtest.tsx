import { useState, useEffect } from 'react'
import { api } from '../api'
import type { BacktestResult, BacktestTrade, StrategyInfo, CompareStrategyResult, OptimizeResult, OptimizeRun, ParamDef } from '../api'
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

// ── Compare tab ───────────────────────────────────────────────────────────────
const COMPARE_COLORS = ['var(--accent)', '#60a5fa', '#f59e0b', '#34d399', '#f87171', '#c084fc']

function CompareTab() {
  const [strategies, setStrategies] = useState<StrategyInfo[]>([])
  const [selected, setSelected]     = useState<string[]>([])
  const [assets, setAssets]         = useState('BTC/USD,ETH/USD')
  const [startDate, setStartDate]   = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10) })
  const [endDate, setEndDate]       = useState(() => new Date().toISOString().slice(0, 10))
  const [cycleHours, setCycleHours] = useState(4)
  const [startEquity, setStartEquity] = useState(10000)
  const [running, setRunning]       = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [results, setResults]       = useState<CompareStrategyResult[] | null>(null)

  useEffect(() => {
    api.listStrategies().then(({ strategies: s }) => setStrategies(s)).catch(() => {})
  }, [])

  const toggleStrategy = (id: string) => {
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const handleCompare = async () => {
    if (selected.length < 2) { setError('Select at least 2 strategies'); return }
    setRunning(true); setError(null); setResults(null)
    try {
      const res = await api.backtestCompare({
        strategyIds: selected,
        assets: assets.split(',').map(a => a.trim()).filter(Boolean),
        startDate, endDate,
        cycleHours: Number(cycleHours),
        startEquity: Number(startEquity),
      })
      setResults(res.strategies)
    } catch (e: any) {
      setError(e.message || 'Compare failed')
    } finally {
      setRunning(false)
    }
  }

  // Build combined chart data
  const chartData: Record<string, number | string>[] = []
  if (results) {
    const maxLen = Math.max(...results.map(r => r.equityCurve.length))
    for (let i = 0; i < maxLen; i++) {
      const point: Record<string, number | string> = {}
      results.forEach(r => {
        const pt = r.equityCurve[i]
        if (pt) {
          point.ts = new Date(pt.ts).toLocaleDateString()
          point[r.strategyId] = pt.equity
        }
      })
      chartData.push(point)
    }
  }

  const bestSharpeId = results
    ? results.reduce((best, r) => ((r.result.sharpe ?? -Infinity) > (best.result.sharpe ?? -Infinity) ? r : best), results[0])?.strategyId
    : null

  return (
    <div>
      {/* Form */}
      <div style={{ ...card, marginBottom: 24 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 12 }}>
          SELECT STRATEGIES
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
          {strategies.map((s, i) => {
            const checked = selected.includes(s.id)
            return (
              <button key={s.id} onClick={() => toggleStrategy(s.id)} style={{
                padding: '6px 14px', borderRadius: 6, fontSize: 11,
                fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
                background: checked ? `${COMPARE_COLORS[i % COMPARE_COLORS.length]}22` : 'var(--card)',
                color: checked ? COMPARE_COLORS[i % COMPARE_COLORS.length] : 'var(--muted)',
                border: `1px solid ${checked ? COMPARE_COLORS[i % COMPARE_COLORS.length] : 'var(--border)'}`,
                cursor: 'pointer', fontWeight: checked ? 600 : 400,
              }}>
                {checked ? '✓ ' : ''}{s.label}
              </button>
            )
          })}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
          {[
            { lbl: 'Assets (comma-separated)', el: <input style={input} value={assets} onChange={e => setAssets(e.target.value)} /> },
            { lbl: 'Start date', el: <input style={input} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} /> },
            { lbl: 'End date', el: <input style={input} type="date" value={endDate} onChange={e => setEndDate(e.target.value)} /> },
            { lbl: 'Cycle (hours)', el: <input style={input} type="number" min={1} max={24} value={cycleHours} onChange={e => setCycleHours(Number(e.target.value))} /> },
            { lbl: 'Start equity ($)', el: <input style={input} type="number" min={100} value={startEquity} onChange={e => setStartEquity(Number(e.target.value))} /> },
          ].map(({ lbl, el }) => (
            <div key={lbl}><span style={label}>{lbl}</span>{el}</div>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button onClick={handleCompare} disabled={running || selected.length < 2} style={{ ...btn(true), opacity: (running || selected.length < 2) ? 0.6 : 1 }}>
            {running ? 'Running…' : 'Compare'}
          </button>
          {error && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)' }}>{error}</span>}
        </div>
      </div>

      {/* Results */}
      {results && results.length > 0 && (
        <>
          {/* Multi-line chart */}
          <div style={{ ...card, marginBottom: 20 }}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>EQUITY CURVES</div>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="ts" tick={{ fill: 'var(--muted)', fontSize: 10 }} tickLine={false} />
                <YAxis tick={{ fill: 'var(--muted)', fontSize: 10 }} tickLine={false} width={80}
                  tickFormatter={(v: number) => `$${v.toLocaleString()}`} />
                <Tooltip
                  contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', fontSize: 11 }}
                  formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name]}
                />
                {results.map((r, i) => (
                  <Line
                    key={r.strategyId}
                    dataKey={r.strategyId}
                    name={r.label}
                    stroke={COMPARE_COLORS[i % COMPARE_COLORS.length]}
                    dot={false}
                    strokeWidth={2}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 12 }}>
              {results.map((r, i) => (
                <div key={r.strategyId} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: COMPARE_COLORS[i % COMPARE_COLORS.length], flexShrink: 0 }} />
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>{r.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Metrics table */}
          <div style={card}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>METRICS COMPARISON</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                <thead>
                  <tr style={{ color: 'var(--muted)' }}>
                    {['Strategy', 'Return', 'Max DD', 'Win Rate', 'Trades', 'Sharpe', 'Sortino'].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 12px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map(r => {
                    const isBest = r.strategyId === bestSharpeId
                    const ret    = r.result.totalReturn * 100
                    return (
                      <tr key={r.strategyId} style={{
                        borderBottom: '1px solid var(--border2)',
                        background: isBest ? 'rgba(var(--accent-rgb, 0,212,170), 0.07)' : 'transparent',
                      }}>
                        <td style={{ padding: '6px 12px', fontWeight: isBest ? 700 : 400, color: isBest ? 'var(--accent)' : 'var(--text)' }}>
                          {r.label}{isBest && <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--accent)' }}>★ BEST</span>}
                        </td>
                        <td style={{ padding: '6px 12px', color: ret >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                          {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
                        </td>
                        <td style={{ padding: '6px 12px' }}>{(r.result.maxDrawdown * 100).toFixed(2)}%</td>
                        <td style={{ padding: '6px 12px' }}>{(r.result.winRate * 100).toFixed(1)}%</td>
                        <td style={{ padding: '6px 12px' }}>{r.result.totalTrades}</td>
                        <td style={{ padding: '6px 12px' }}>{r.result.sharpe?.toFixed(2) ?? '—'}</td>
                        <td style={{ padding: '6px 12px' }}>{r.result.sortino?.toFixed(2) ?? '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Optimize tab ──────────────────────────────────────────────────────────────
function OptimizeTab() {
  const RULE_BASED = ['momentum', 'meanReversion', 'breakout', 'trendFollowing']

  const [strategies, setStrategies]       = useState<StrategyInfo[]>([])
  const [strategyId, setStrategyId]       = useState(RULE_BASED[0])
  const [assets, setAssets]               = useState('BTC/USD,ETH/USD')
  const [startDate, setStartDate]         = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 3); return d.toISOString().slice(0, 10) })
  const [endDate, setEndDate]             = useState(() => new Date().toISOString().slice(0, 10))
  const [cycleHours, setCycleHours]       = useState(4)
  const [startEquity, setStartEquity]     = useState(10000)
  const [paramGrid, setParamGrid]         = useState<Record<string, (number | boolean | string)[]>>({})
  const [running, setRunning]             = useState(false)
  const [error, setError]                 = useState<string | null>(null)
  const [result, setResult]               = useState<OptimizeResult | null>(null)
  const [applyMsg, setApplyMsg]           = useState<string | null>(null)

  // Load strategies once
  useEffect(() => {
    api.listStrategies().then(({ strategies: s }) => {
      const rb = s.filter(x => RULE_BASED.includes(x.id))
      setStrategies(rb)
      if (rb.length > 0) setStrategyId(rb[0].id)
    }).catch(() => {})
  }, [])

  const currentStrategy = strategies.find(s => s.id === strategyId)

  // Reset param grid when strategy changes; also load past results
  useEffect(() => {
    if (!currentStrategy) return
    const grid: Record<string, (number | boolean | string)[]> = {}
    for (const def of currentStrategy.params) {
      if (def.gridValues && def.gridValues.length > 0) {
        grid[def.key] = [...def.gridValues]
      }
    }
    setParamGrid(grid)
    setResult(null)
    api.optimizeResults(strategyId).then(res => {
      if (res && res.length > 0) setResult(res[0])
    }).catch(() => {})
  }, [strategyId, currentStrategy])

  const toggleGridValue = (key: string, val: number | boolean | string) => {
    setParamGrid(prev => {
      const curr = prev[key] || []
      return {
        ...prev,
        [key]: curr.includes(val) ? curr.filter(v => v !== val) : [...curr, val],
      }
    })
  }

  const estCombinations = Object.values(paramGrid).reduce((acc, vals) => acc * (vals.length || 1), 1)

  const handleOptimize = async () => {
    setRunning(true); setError(null); setResult(null)
    try {
      const res = await api.runOptimize({
        strategyId,
        assets: assets.split(',').map(a => a.trim()).filter(Boolean),
        startDate, endDate,
        cycleHours: Number(cycleHours),
        startEquity: Number(startEquity),
        paramGrid,
      })
      setResult(res)
    } catch (e: any) {
      setError(e.message || 'Optimize failed')
    } finally {
      setRunning(false)
    }
  }

  const handleApply = async (run: OptimizeRun) => {
    setApplyMsg(null)
    try {
      await api.setStrategyParams(strategyId, run.params)
      setApplyMsg('Parameters applied!')
      setTimeout(() => setApplyMsg(null), 3000)
    } catch (e: any) {
      setApplyMsg(`Error: ${e.message}`)
    }
  }

  const paramsWithGrid = currentStrategy?.params.filter(d => d.gridValues && d.gridValues.length > 0) ?? []

  return (
    <div>
      {/* Form */}
      <div style={{ ...card, marginBottom: 24 }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div>
            <span style={label}>Strategy</span>
            <select style={input} value={strategyId} onChange={e => setStrategyId(e.target.value)}>
              {strategies.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          {[
            { lbl: 'Assets', val: assets, set: setAssets, type: 'text' },
            { lbl: 'Start date', val: startDate, set: setStartDate, type: 'date' },
            { lbl: 'End date', val: endDate, set: setEndDate, type: 'date' },
            { lbl: 'Cycle (hours)', val: String(cycleHours), set: (v: string) => setCycleHours(Number(v)), type: 'number' },
            { lbl: 'Start equity ($)', val: String(startEquity), set: (v: string) => setStartEquity(Number(v)), type: 'number' },
          ].map(({ lbl, val, set, type }) => (
            <div key={lbl}>
              <span style={label}>{lbl}</span>
              <input style={input} type={type} value={val} onChange={e => set(e.target.value)} min={type === 'number' ? 1 : undefined} />
            </div>
          ))}
        </div>

        {/* Param grid section */}
        {paramsWithGrid.length > 0 && (
          <div style={{ marginBottom: 20 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 12 }}>
              PARAMETER GRID
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {paramsWithGrid.map((def: ParamDef) => {
                const selected = paramGrid[def.key] || []
                return (
                  <div key={def.key}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', marginBottom: 6 }}>
                      {def.label}
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      {(def.gridValues || []).map((v, i) => {
                        const checked = selected.includes(v)
                        return (
                          <button key={i} onClick={() => toggleGridValue(def.key, v)} style={{
                            padding: '4px 12px', borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-mono)',
                            background: checked ? 'rgba(var(--accent-rgb, 0,212,170), 0.15)' : 'var(--bg3)',
                            color: checked ? 'var(--accent)' : 'var(--muted)',
                            border: `1px solid ${checked ? 'rgba(var(--accent-rgb, 0,212,170), 0.4)' : 'var(--border2)'}`,
                            cursor: 'pointer', fontWeight: checked ? 600 : 400,
                          }}>
                            {String(v)}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ marginTop: 12, fontFamily: 'var(--font-mono)', fontSize: 11, color: estCombinations > 500 ? 'var(--danger)' : 'var(--muted)' }}>
              Est. combinations: {estCombinations.toLocaleString()}
              {estCombinations > 500 && <span style={{ marginLeft: 8 }}>— Too many! Reduce selections to run.</span>}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={handleOptimize}
            disabled={running || estCombinations > 500}
            style={{ ...btn(true), opacity: (running || estCombinations > 500) ? 0.6 : 1 }}
          >
            {running ? 'Optimizing…' : 'Optimize'}
          </button>
          {error && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)' }}>{error}</span>}
        </div>
      </div>

      {/* Results */}
      {result && (
        <>
          {/* Best params summary */}
          <div style={{ ...card, marginBottom: 16, background: 'rgba(var(--accent-rgb, 0,212,170), 0.05)', border: '1px solid rgba(var(--accent-rgb, 0,212,170), 0.2)' }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', letterSpacing: '0.08em', marginBottom: 8 }}>
              BEST PARAMS SUMMARY
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text)', marginBottom: 8 }}>
              Sharpe: <strong>{result.bestSharpe.toFixed(3)}</strong> — {result.totalRuns} total runs
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {Object.entries(result.bestParams).map(([k, v]) => (
                <span key={k} style={{
                  padding: '3px 10px', borderRadius: 4, fontSize: 11, fontFamily: 'var(--font-mono)',
                  background: 'rgba(var(--accent-rgb, 0,212,170), 0.1)', color: 'var(--accent)',
                  border: '1px solid rgba(var(--accent-rgb, 0,212,170), 0.25)',
                }}>
                  {k}={String(v)}
                </span>
              ))}
            </div>
          </div>

          {/* Top runs table */}
          <div style={card}>
            <div style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', marginBottom: 12 }}>
              TOP RUNS
            </div>
            {applyMsg && (
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)', marginBottom: 10 }}>{applyMsg}</div>
            )}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                <thead>
                  <tr style={{ color: 'var(--muted)' }}>
                    {['Params', 'Sharpe', 'Sortino', 'Return', 'Max DD', 'Win Rate', 'Trades', ''].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.runs.slice(0, 10).map((run, i) => {
                    const isBest = i === 0
                    const ret    = run.totalReturn * 100
                    return (
                      <tr key={i} style={{
                        borderBottom: '1px solid var(--border2)',
                        background: isBest ? 'rgba(var(--accent-rgb, 0,212,170), 0.07)' : 'transparent',
                      }}>
                        <td style={{ padding: '6px 10px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {Object.entries(run.params).map(([k, v]) => (
                              <span key={k} style={{
                                padding: '1px 6px', borderRadius: 3, fontSize: 10, fontFamily: 'var(--font-mono)',
                                background: 'var(--bg3)', color: 'var(--muted)', border: '1px solid var(--border2)',
                              }}>
                                {k}={String(v)}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: '6px 10px', fontWeight: isBest ? 700 : 400, color: isBest ? 'var(--accent)' : 'var(--text)' }}>
                          {run.sharpe.toFixed(3)}
                        </td>
                        <td style={{ padding: '6px 10px' }}>{run.sortino.toFixed(3)}</td>
                        <td style={{ padding: '6px 10px', color: ret >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                          {ret >= 0 ? '+' : ''}{ret.toFixed(2)}%
                        </td>
                        <td style={{ padding: '6px 10px' }}>{(run.maxDrawdown * 100).toFixed(2)}%</td>
                        <td style={{ padding: '6px 10px' }}>{(run.winRate * 100).toFixed(1)}%</td>
                        <td style={{ padding: '6px 10px' }}>{run.totalTrades}</td>
                        <td style={{ padding: '6px 10px' }}>
                          <button onClick={() => handleApply(run)} style={{ ...btn(), padding: '3px 10px', fontSize: 10 }}>
                            Apply
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

// ── Run tab (original content) ────────────────────────────────────────────────
function RunTab() {
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
    <div>
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

// ── Main Backtest export ───────────────────────────────────────────────────────
type BacktestTab = 'run' | 'compare' | 'optimize'

export function Backtest() {
  const [activeTab, setActiveTab] = useState<BacktestTab>('run')

  const TABS: { id: BacktestTab; label: string }[] = [
    { id: 'run',      label: 'Run' },
    { id: 'compare',  label: 'Compare' },
    { id: 'optimize', label: 'Optimize' },
  ]

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 20px', fontFamily: 'var(--font-mono)', fontSize: 16, letterSpacing: '0.08em', color: 'var(--text)' }}>
        BACKTEST
      </h2>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            style={{
              padding: '8px 20px', borderRadius: '6px 6px 0 0', fontSize: 12,
              fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
              background: activeTab === t.id ? 'var(--card)' : 'transparent',
              color: activeTab === t.id ? 'var(--accent)' : 'var(--muted)',
              border: activeTab === t.id ? '1px solid var(--border)' : '1px solid transparent',
              borderBottom: activeTab === t.id ? '1px solid var(--card)' : '1px solid transparent',
              cursor: 'pointer', marginBottom: -1,
              fontWeight: activeTab === t.id ? 600 : 400,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {activeTab === 'run'      && <RunTab />}
      {activeTab === 'compare'  && <CompareTab />}
      {activeTab === 'optimize' && <OptimizeTab />}
    </div>
  )
}
