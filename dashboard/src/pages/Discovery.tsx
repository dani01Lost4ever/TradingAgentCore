import { useState, useEffect, useCallback, useRef } from 'react'
import { api } from '../api'
import type { DiscoveryRun, WalletInfo, TradingMode, Trade } from '../api'

const MODE_LABEL: Record<TradingMode, string> = {
  scalp: 'SCALP',
  swing: 'SWING',
  long_term: 'LONG TERM',
}

const ACTION_COLOR: Record<string, string> = {
  buy: 'var(--green)',
  sell: 'var(--danger)',
  hold: 'var(--muted)',
}

// Score bar: hairline (1px) lime fill against var(--border)
function scoreBar(score: number) {
  const pct = Math.round(score * 100)
  const color = pct >= 70 ? 'var(--green)' : pct >= 40 ? 'var(--accent)' : 'var(--muted)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{
        display: 'inline-block',
        width: 56,
        height: 1,
        background: 'var(--border)',
        position: 'relative',
        overflow: 'visible',
      }}>
        <span style={{
          display: 'block',
          width: `${pct}%`,
          height: '100%',
          background: color,
        }} />
      </span>
      <span style={{
        color,
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontVariantNumeric: 'tabular-nums',
        minWidth: 30,
        textAlign: 'right',
      }}>{pct}%</span>
    </span>
  )
}

// ── Last decision per asset panel ─────────────────────────────────────────────
interface LastDecision {
  asset: string
  action: string
  confidence: number
  reasoning: string
  timestamp: string
}

function LastDecisionsPanel({ walletId }: { walletId: string }) {
  const [decisions, setDecisions] = useState<LastDecision[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchDecisions = useCallback(async () => {
    if (!walletId) return
    try {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const { trades } = await api.reasoning({ limit: 20 })
      const filtered = (trades as (Trade & { walletId?: string })[])
        .filter(t => {
          const ts = new Date(t.timestamp).getTime()
          return ts >= new Date(since).getTime()
        })
      const byAsset = new Map<string, LastDecision>()
      for (const t of filtered) {
        const a = t.decision.asset
        if (!byAsset.has(a)) {
          byAsset.set(a, {
            asset: a,
            action: t.decision.action,
            confidence: t.decision.confidence,
            reasoning: t.decision.reasoning,
            timestamp: t.timestamp,
          })
        }
      }
      setDecisions([...byAsset.values()])
    } catch { /* silent — panel is best-effort */ }
  }, [walletId])

  useEffect(() => {
    fetchDecisions()
    timerRef.current = setInterval(fetchDecisions, 15_000)
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [fetchDecisions])

  if (decisions.length === 0) return null

  return (
    <div style={{ marginBottom: 28 }}>
      <div style={{
        fontFamily: 'var(--font-mono)',
        fontSize: 10,
        fontWeight: 700,
        color: 'var(--muted)',
        letterSpacing: '0.09em',
        marginBottom: 10,
        padding: '0 0 6px',
        borderBottom: '1px solid var(--border)',
      }} className="aurora-section-title">
        WHAT THE AI THOUGHT &mdash; last decision per asset &middot; last 24h &middot; auto-refresh 15s
      </div>
      <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', padding: 16 }}>
        <table className="aurora-table">
          <thead>
            <tr>
              {['ASSET', 'ACTION', 'CONF', 'REASONING', 'WHEN'].map(h => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {decisions.map(d => (
              <tr key={d.asset}>
                <td style={{ fontWeight: 700, color: 'var(--text)', letterSpacing: '0.04em' }}>{d.asset}</td>
                <td>
                  <span style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 700,
                    color: ACTION_COLOR[d.action] ?? 'var(--text)',
                    letterSpacing: '0.06em',
                  }}>
                    {d.action.toUpperCase()}
                  </span>
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {Math.round(d.confidence * 100)}%
                </td>
                <td style={{ color: 'var(--muted)', fontFamily: 'var(--font-sans)', fontSize: '0.72rem', maxWidth: 360 }}>
                  {d.reasoning.slice(0, 120)}{d.reasoning.length > 120 ? '…' : ''}
                </td>
                <td style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {new Date(d.timestamp).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main Discovery component ──────────────────────────────────────────────────
export function Discovery() {
  const [wallets, setWallets] = useState<WalletInfo[]>([])
  const [activeWalletId, setActiveWalletId] = useState<string>('')
  const [runs, setRuns] = useState<DiscoveryRun[]>([])
  const [loading, setLoading] = useState(false)
  const [triggering, setTriggering] = useState(false)
  const [cycling, setCycling] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; text: string } | null>(null)

  // Checkboxes for adopt: Map<runId, Set<symbol>>
  const [checked, setChecked] = useState<Map<string, Set<string>>>(new Map())
  const [adopting, setAdopting] = useState(false)

  // Current universe for the active wallet
  const [currentAssets, setCurrentAssets] = useState<string[]>([])
  const [removingAsset, setRemovingAsset] = useState<string | null>(null)

  const showToast = (ok: boolean, text: string) => {
    setToast({ ok, text })
    setTimeout(() => setToast(null), 5000)
  }

  const handleRemoveAsset = async (symbol: string) => {
    if (!activeWalletId || removingAsset) return
    const next = currentAssets.filter(a => a !== symbol)
    setRemovingAsset(symbol)
    // optimistic update so the chip disappears instantly
    setCurrentAssets(next)
    try {
      await api.setWalletTradingConfig(activeWalletId, { assets: next })
      showToast(true, `Removed ${symbol} from universe.`)
    } catch (e: any) {
      // rollback on failure
      setCurrentAssets(currentAssets)
      showToast(false, e.message || `Failed to remove ${symbol}`)
    } finally {
      setRemovingAsset(null)
    }
  }

  const handleClearAll = async () => {
    if (!activeWalletId) return
    if (currentAssets.length === 0) return
    if (!window.confirm(`Remove all ${currentAssets.length} assets from this wallet's universe? You can re-adopt them from a discovery run.`)) return
    const prev = currentAssets
    setCurrentAssets([])
    try {
      await api.setWalletTradingConfig(activeWalletId, { assets: [] })
      showToast(true, `Cleared ${prev.length} asset${prev.length !== 1 ? 's' : ''} from universe.`)
    } catch (e: any) {
      setCurrentAssets(prev)
      showToast(false, e.message || 'Failed to clear universe')
    }
  }

  useEffect(() => {
    api.wallets().then(({ wallets: ws }) => {
      setWallets(ws)
      const active = ws.find(w => w.active)
      if (active) setActiveWalletId(active.id)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (!activeWalletId) return
    api.walletTradingConfig(activeWalletId)
      .then(cfg => setCurrentAssets(cfg.assets ?? []))
      .catch(() => {})
  }, [activeWalletId])

  const loadRuns = useCallback(() => {
    if (!activeWalletId) return
    setLoading(true)
    setError(null)
    api.discoveryRuns(activeWalletId, 20)
      .then(({ runs: r }) => {
        setRuns(r)
        if (r.length > 0) {
          setChecked(prev => {
            const next = new Map(prev)
            if (!next.has(r[0]._id)) {
              const top5 = [...r[0].candidates]
                .sort((a, b) => b.score - a.score)
                .slice(0, 5)
                .map(c => c.symbol)
              next.set(r[0]._id, new Set(top5))
            }
            return next
          })
        }
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [activeWalletId])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  const handleRunNow = async () => {
    if (!activeWalletId || triggering) return
    setTriggering(true)
    setError(null)
    try {
      const { run } = await api.triggerDiscovery(activeWalletId)
      setRuns(prev => [run, ...prev])
      setChecked(prev => {
        const next = new Map(prev)
        const top5 = [...run.candidates]
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map(c => c.symbol)
        next.set(run._id, new Set(top5))
        return next
      })
    } catch (e: any) {
      setError(e.message)
    } finally {
      setTriggering(false)
    }
  }

  const handleRunCycle = async () => {
    if (!activeWalletId || cycling) return
    setCycling(true)
    try {
      const res = await api.triggerWalletCycle(activeWalletId)
      showToast(true, res.message)
    } catch (e: any) {
      showToast(false, e.message || 'Failed to trigger cycle')
    } finally {
      setCycling(false)
    }
  }

  const toggleCheck = (runId: string, symbol: string) => {
    setChecked(prev => {
      const next = new Map(prev)
      const set = new Set(next.get(runId) ?? [])
      if (set.has(symbol)) set.delete(symbol)
      else set.add(symbol)
      next.set(runId, set)
      return next
    })
  }

  const allCheckedSymbols = (): { symbol: string; score: number }[] => {
    const symbolScores = new Map<string, number>()
    for (const run of runs) {
      const sel = checked.get(run._id)
      if (!sel) continue
      for (const c of run.candidates) {
        if (sel.has(c.symbol) && !symbolScores.has(c.symbol)) {
          symbolScores.set(c.symbol, c.score)
        }
      }
    }
    return [...symbolScores.entries()].map(([symbol, score]) => ({ symbol, score }))
  }

  const handleAdopt = async () => {
    if (!activeWalletId || adopting) return
    const selected = allCheckedSymbols()
    if (selected.length === 0) {
      showToast(false, 'No candidates selected')
      return
    }
    setAdopting(true)
    try {
      const cfg = await api.walletTradingConfig(activeWalletId)
      const existing = cfg.assets ?? []

      const existingSet = new Set(existing)
      const newCandidates = selected.filter(s => !existingSet.has(s.symbol))
      const merged = [...existing]

      if (merged.length + newCandidates.length > 20) {
        const slots = Math.max(0, 20 - merged.length)
        const top = newCandidates.sort((a, b) => b.score - a.score).slice(0, slots)
        merged.push(...top.map(s => s.symbol))
      } else {
        merged.push(...newCandidates.map(s => s.symbol))
      }

      const added = merged.length - existing.length
      if (added === 0) {
        showToast(false, 'All selected candidates are already in the universe (or cap reached)')
        return
      }

      await api.setWalletTradingConfig(activeWalletId, { assets: merged })
      setCurrentAssets(merged)

      const walletName = wallets.find(w => w.id === activeWalletId)?.name ?? activeWalletId
      showToast(true, `Added ${added} asset${added !== 1 ? 's' : ''} to ${walletName}. Run a cycle to evaluate them.`)
    } catch (e: any) {
      showToast(false, e.message || 'Failed to adopt assets')
    } finally {
      setAdopting(false)
    }
  }

  const totalSelected = allCheckedSymbols().length

  return (
    <div style={{ padding: '28px 28px 40px', maxWidth: 1400, margin: '0 auto', position: 'relative' }}>

      {/* ── Header row ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 15, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)', letterSpacing: '0.08em' }}>
          DISCOVERY
        </h1>

        {wallets.length > 1 && (
          <select
            value={activeWalletId}
            onChange={e => setActiveWalletId(e.target.value)}
            style={{
              background: 'var(--bg3)',
              border: '1px solid var(--border2)',
              color: 'var(--text)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              padding: '4px 8px',
              borderRadius: 0,
            }}
          >
            {wallets.map(w => (
              <option key={w.id} value={w.id}>{w.name}{w.active ? ' (active)' : ''}</option>
            ))}
          </select>
        )}

        <button
          onClick={handleRunNow}
          disabled={triggering || !activeWalletId}
          style={{
            padding: '6px 14px',
            borderRadius: 0,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.06em',
            background: triggering ? 'transparent' : 'var(--accent)',
            color: triggering ? 'var(--muted)' : '#000',
            border: triggering ? '1px solid var(--border)' : '1px solid var(--accent)',
            cursor: triggering ? 'not-allowed' : 'pointer',
          }}
        >
          {triggering ? 'RUNNING...' : 'RUN DISCOVERY NOW'}
        </button>

        {loading && (
          <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>loading...</span>
        )}
      </div>

      {/* ── Intro / explainer panel ── */}
      <div style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        padding: 16,
        marginBottom: 28,
      }}>
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.09em',
          color: 'var(--accent)',
          marginBottom: 10,
        }}>
          HOW THIS PAGE WORKS
        </div>
        <p style={{ margin: '0 0 8px', fontFamily: 'var(--font-sans)', fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 1.6 }}>
          This page suggests new assets for your wallet&rsquo;s trading universe. Click{' '}
          <strong style={{ color: 'var(--text)' }}>RUN DISCOVERY NOW</strong> to generate a fresh candidate list.
          Scores are computed from live market signals (RSI, EMA trend, ATR volatility, volume ratio, 7-day change) &mdash; no LLM call, no cost.
        </p>
        <ol style={{ margin: 0, paddingLeft: 18, fontFamily: 'var(--font-sans)', fontSize: '0.78rem', color: 'var(--muted)', lineHeight: 2 }}>
          <li>Tick the candidates you want to consider in the <strong style={{ color: 'var(--text)' }}>NEW CANDIDATES</strong> table below.</li>
          <li><strong style={{ color: 'var(--accent)' }}>ADOPT SELECTED</strong> &mdash; adds them to your wallet&rsquo;s assets list (max 20).</li>
          <li><strong style={{ color: 'var(--text)' }}>RUN CYCLE NOW</strong> &mdash; the AI evaluates each asset and decides BUY / SELL / HOLD.</li>
          <li>Watch the <strong style={{ color: 'var(--text)' }}>WHAT THE AI THOUGHT</strong> section below &mdash; it shows the AI&rsquo;s verdict per asset.</li>
        </ol>
      </div>

      {/* ── Current universe ── */}
      <div style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        padding: 16,
        marginBottom: 28,
      }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          marginBottom: 12,
          paddingBottom: 8,
          borderBottom: '1px solid var(--border)',
          flexWrap: 'wrap',
        }}>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.09em',
            color: 'var(--muted)',
          }} className="aurora-section-title">
            CURRENT UNIVERSE &mdash; click &times; to remove
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: currentAssets.length >= 20 ? 'var(--warn)' : 'var(--muted)',
              fontVariantNumeric: 'tabular-nums',
              letterSpacing: '0.05em',
            }}>
              {currentAssets.length} / 20 {currentAssets.length >= 20 ? '· CAP REACHED' : ''}
            </span>
            {currentAssets.length > 0 && (
              <button
                onClick={handleClearAll}
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  letterSpacing: '0.06em',
                  background: 'transparent',
                  border: '1px solid var(--danger)',
                  color: 'var(--danger)',
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}
              >
                CLEAR ALL
              </button>
            )}
          </div>
        </div>
        {currentAssets.length === 0 ? (
          <div style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '0.78rem',
            color: 'var(--muted)',
            padding: '8px 0',
          }}>
            No assets in this wallet&rsquo;s universe. Run discovery, tick candidates, and click ADOPT SELECTED below.
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {currentAssets.map(symbol => (
              <span key={symbol} style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.03em',
                color: 'var(--text)',
                background: 'var(--bg3)',
                border: '1px solid var(--border2)',
                padding: '4px 4px 4px 10px',
                opacity: removingAsset === symbol ? 0.4 : 1,
              }}>
                {symbol}
                <button
                  onClick={() => handleRemoveAsset(symbol)}
                  disabled={removingAsset === symbol}
                  title={`Remove ${symbol} from universe`}
                  aria-label={`Remove ${symbol}`}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 12,
                    lineHeight: 1,
                    color: 'var(--muted)',
                    background: 'transparent',
                    border: 'none',
                    padding: '2px 6px',
                    cursor: removingAsset === symbol ? 'wait' : 'pointer',
                  }}
                  onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--danger)' }}
                  onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)' }}
                >
                  &times;
                </button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Toast ── */}
      {toast && (
        <div style={{
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          color: toast.ok ? 'var(--green)' : 'var(--danger)',
          background: 'var(--bg2)',
          border: `1px solid ${toast.ok ? 'var(--green)' : 'var(--danger)'}`,
          padding: '8px 14px',
          marginBottom: 16,
        }}>
          {toast.ok ? '✓' : '✗'} {toast.text}
        </div>
      )}

      {error && (
        <div style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: 11, marginBottom: 16 }}>
          Error: {error}
        </div>
      )}

      {/* ── Section 1: What the AI thought (last decision per asset) ── */}
      {activeWalletId && <LastDecisionsPanel walletId={activeWalletId} />}

      {/* ── Section 2: New candidates ── */}
      {!loading && !error && runs.length === 0 && (
        <div style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 12 }}>
          No discovery runs yet for this wallet. Click RUN DISCOVERY NOW to start one.
        </div>
      )}

      {runs.length > 0 && (
        <>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            fontWeight: 700,
            color: 'var(--muted)',
            letterSpacing: '0.09em',
            marginBottom: 10,
            padding: '0 0 6px',
            borderBottom: '1px solid var(--border)',
          }} className="aurora-section-title">
            NEW CANDIDATES &mdash; adopt into the wallet&rsquo;s universe
          </div>

          {runs.map(run => {
            const runChecked = checked.get(run._id) ?? new Set<string>()
            return (
              <div key={run._id} style={{
                background: 'var(--bg2)',
                border: '1px solid var(--border)',
                padding: 16,
                marginBottom: 1,
              }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span style={{
                      fontSize: 10,
                      fontFamily: 'var(--font-mono)',
                      padding: '2px 6px',
                      borderRadius: 0,
                      border: '1px solid var(--border-accent)',
                      color: 'var(--accent)',
                      letterSpacing: '0.05em',
                    }}>
                      {MODE_LABEL[run.tradingMode] ?? run.tradingMode}
                    </span>
                    <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                      source: {run.source}
                    </span>
                  </div>
                  <span style={{ color: 'var(--muted)', fontFamily: 'var(--font-mono)', fontSize: 10 }}>
                    {new Date(run.ts).toLocaleString()}
                  </span>
                </div>

                <table className="aurora-table">
                  <thead>
                    <tr>
                      <th style={{ width: 28 }}>
                        <input
                          type="checkbox"
                          checked={run.candidates.every(c => runChecked.has(c.symbol))}
                          onChange={e => {
                            const all = run.candidates.map(c => c.symbol)
                            setChecked(prev => {
                              const next = new Map(prev)
                              next.set(run._id, e.target.checked ? new Set(all) : new Set())
                              return next
                            })
                          }}
                          title="Select all"
                          style={{ cursor: 'pointer', accentColor: 'var(--accent)' }}
                        />
                      </th>
                      {['SYMBOL', 'REASON', 'SCORE'].map(h => (
                        <th key={h}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {run.candidates.map((c, i) => {
                      const alreadyAdopted = currentAssets.includes(c.symbol)
                      return (
                        <tr key={i} style={{ background: runChecked.has(c.symbol) ? 'rgba(200,255,0,0.04)' : undefined }}>
                          <td>
                            <input
                              type="checkbox"
                              checked={runChecked.has(c.symbol)}
                              onChange={() => !alreadyAdopted && toggleCheck(run._id, c.symbol)}
                              disabled={alreadyAdopted}
                              style={{
                                cursor: alreadyAdopted ? 'default' : 'pointer',
                                accentColor: 'var(--accent)',
                                opacity: alreadyAdopted ? 0.35 : 1,
                              }}
                            />
                          </td>
                          <td style={{
                            fontWeight: 700,
                            color: alreadyAdopted ? 'var(--muted)' : 'var(--text)',
                            letterSpacing: '0.04em',
                            fontVariantNumeric: 'tabular-nums',
                            whiteSpace: 'nowrap',
                          }}>
                            {c.symbol}
                            {alreadyAdopted && (
                              <span style={{
                                marginLeft: 6,
                                fontSize: 9,
                                fontWeight: 400,
                                color: 'var(--muted)',
                                fontFamily: 'var(--font-mono)',
                                letterSpacing: '0.05em',
                              }}>Adopted</span>
                            )}
                          </td>
                          <td style={{
                            color: alreadyAdopted ? 'var(--muted)' : 'var(--muted)',
                            fontFamily: 'var(--font-sans)',
                            fontSize: '0.72rem',
                            maxWidth: 420,
                            whiteSpace: 'normal',
                            lineHeight: 1.5,
                          }}>
                            {c.score === 0 && c.reason === 'No market data available'
                              ? <span style={{ color: 'var(--danger)', fontFamily: 'var(--font-mono)', fontSize: 9 }}>No market data</span>
                              : c.reason
                            }
                          </td>
                          <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                            {scoreBar(c.score)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          })}
        </>
      )}

      {/* ── Spacer so content isn't hidden behind sticky footer ── */}
      {runs.length > 0 && <div style={{ height: 72 }} />}

      {/* ── Sticky footer: selection count + adopt + run cycle ── */}
      {runs.length > 0 && (
        <div style={{
          position: 'sticky',
          bottom: 0,
          background: 'var(--bg1)',
          borderTop: '1px solid var(--border)',
          padding: '14px 28px',
          margin: '0 -28px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          flexWrap: 'wrap',
        }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
            {totalSelected > 0
              ? `${totalSelected} selected · cap 20 assets max`
              : 'Select candidates above to adopt them'}
          </span>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button
              onClick={handleAdopt}
              disabled={adopting || totalSelected === 0}
              style={{
                padding: '8px 18px',
                borderRadius: 0,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                background: adopting || totalSelected === 0 ? 'transparent' : 'var(--accent)',
                color: adopting || totalSelected === 0 ? 'var(--muted)' : '#000',
                border: adopting || totalSelected === 0 ? '1px solid var(--border)' : '1px solid var(--accent)',
                cursor: adopting || totalSelected === 0 ? 'not-allowed' : 'pointer',
                fontWeight: 700,
              }}
            >
              {adopting ? 'ADOPTING...' : `ADOPT SELECTED${totalSelected > 0 ? ` (${totalSelected})` : ''}`}
            </button>

            <button
              onClick={handleRunCycle}
              disabled={cycling || !activeWalletId}
              style={{
                padding: '8px 18px',
                borderRadius: 0,
                fontSize: 11,
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.06em',
                background: 'transparent',
                color: cycling ? 'var(--muted)' : 'var(--text)',
                border: cycling ? '1px solid var(--border)' : '1px solid var(--border2)',
                cursor: cycling ? 'not-allowed' : 'pointer',
              }}
            >
              {cycling ? 'RUNNING...' : 'RUN CYCLE NOW'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
