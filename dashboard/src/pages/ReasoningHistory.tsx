import { useState, useEffect, useCallback } from 'react'
import { api } from '../api'
import type { Trade } from '../api'

const card: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '20px 24px',
}

const btn = (primary = false): React.CSSProperties => ({
  padding: '7px 16px', borderRadius: 6, fontSize: 11,
  fontFamily: 'var(--font-mono)', letterSpacing: '0.06em',
  border: '1px solid var(--border)', cursor: 'pointer',
  background: primary ? 'var(--accent)' : 'var(--card)',
  color: primary ? '#000' : 'var(--text)',
})

const inputStyle: React.CSSProperties = {
  padding: '7px 12px', background: 'var(--input-bg)',
  border: '1px solid var(--border)', borderRadius: 6,
  color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
}

function ReplayModal({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const snapshot = (trade.market ?? {})[trade.decision.asset] ?? {}

  const rows: [string, string | number | undefined][] = [
    ['Price', snapshot.price],
    ['24h change', snapshot.change_24h != null ? `${snapshot.change_24h.toFixed(2)}%` : undefined],
    ['RSI 14', (snapshot as any).rsi_14?.toFixed(2)],
    ['EMA 9', (snapshot as any).ema_9?.toFixed(4)],
    ['EMA 21', (snapshot as any).ema_21?.toFixed(4)],
    ['MACD', (snapshot as any).macd?.toFixed(4)],
    ['MACD Signal', (snapshot as any).macd_signal?.toFixed(4)],
    ['MACD Hist', (snapshot as any).macd_hist?.toFixed(4)],
    ['BB Upper', (snapshot as any).bb_upper?.toFixed(4)],
    ['BB Lower', (snapshot as any).bb_lower?.toFixed(4)],
    ['BB %', (snapshot as any).bb_pct?.toFixed(3)],
    ['ATR 14', (snapshot as any).atr_14?.toFixed(4)],
    ['Volume 24h', snapshot.volume_24h?.toLocaleString()],
    ['Vol SMA20', (snapshot as any).volume_sma20?.toLocaleString()],
    ['Daily SMA50', (snapshot as any).daily_sma50?.toFixed(2)],
  ]

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          ...card, width: 580, maxHeight: '85vh', overflowY: 'auto',
          display: 'flex', flexDirection: 'column', gap: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-mono)', marginBottom: 4 }}>
              Trade Replay
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>
              {new Date(trade.timestamp).toLocaleString()} — {trade.decision.asset}
            </div>
          </div>
          <button onClick={onClose} style={{ ...btn(), padding: '4px 10px', fontSize: 12 }}>✕</button>
        </div>

        {/* Decision */}
        <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '14px 16px' }}>
          <div style={{ display: 'flex', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{
              fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, padding: '3px 10px',
              borderRadius: 4, background: trade.decision.action === 'buy'
                ? 'rgba(0,212,130,0.15)' : trade.decision.action === 'sell'
                  ? 'rgba(239,68,68,0.15)' : 'rgba(150,150,150,0.15)',
              color: trade.decision.action === 'buy' ? 'var(--green)'
                : trade.decision.action === 'sell' ? 'var(--danger)' : 'var(--muted)',
            }}>
              {trade.decision.action.toUpperCase()}
            </span>
            <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
              ${trade.decision.amount_usd.toFixed(0)} · conf {(trade.decision.confidence * 100).toFixed(0)}%
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
            {trade.decision.reasoning}
          </div>
        </div>

        {/* Indicators grid */}
        <div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 10 }}>
            MARKET SNAPSHOT — {trade.decision.asset}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            {rows.filter(([, v]) => v != null && v !== undefined).map(([name, val]) => (
              <div key={name} style={{
                background: 'var(--bg)', borderRadius: 6, padding: '8px 10px',
                display: 'flex', flexDirection: 'column', gap: 2,
              }}>
                <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{name}</div>
                <div style={{ fontSize: 12, fontFamily: 'var(--font-mono)', color: 'var(--text)' }}>{val}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Outcome */}
        {trade.outcome && (
          <div style={{ background: 'var(--bg)', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 8 }}>OUTCOME</div>
            <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
              {[
                ['PnL', `${trade.outcome.pnl_usd >= 0 ? '+' : ''}$${trade.outcome.pnl_usd.toFixed(2)}`],
                ['Return', `${trade.outcome.pnl_pct >= 0 ? '+' : ''}${trade.outcome.pnl_pct.toFixed(2)}%`],
                ['Resolved', new Date(trade.outcome.resolved_at).toLocaleDateString()],
                ['Correct', trade.outcome.correct ? 'Yes' : 'No'],
              ].map(([k, v]) => (
                <div key={k}>
                  <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{k}</div>
                  <div style={{ fontSize: 13, fontFamily: 'var(--font-mono)', color: k === 'PnL' || k === 'Return'
                    ? (parseFloat(v as string) >= 0 ? 'var(--green)' : 'var(--danger)') : 'var(--text)' }}>{v}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

const LIMIT = 25

export function ReasoningHistory() {
  const [trades, setTrades] = useState<Trade[]>([])
  const [total, setTotal]   = useState(0)
  const [page, setPage]     = useState(1)
  const [filterAsset, setFilterAsset]   = useState('')
  const [filterAction, setFilterAction] = useState('')
  const [filterOutcome, setFilterOutcome] = useState('')
  const [loading, setLoading] = useState(false)
  const [replay, setReplay]   = useState<Trade | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.reasoning({
        asset: filterAsset || undefined,
        action: filterAction || undefined,
        outcome: filterOutcome || undefined,
        limit: LIMIT,
        page,
      })
      setTrades(res.trades)
      setTotal(res.total)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }, [filterAsset, filterAction, filterOutcome, page])

  useEffect(() => { load() }, [load])

  const totalPages = Math.max(1, Math.ceil(total / LIMIT))

  function applyFilters() {
    setPage(1)
    load()
  }

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 28px', fontFamily: 'var(--font-mono)', fontSize: 16, letterSpacing: '0.08em', color: 'var(--text)' }}>
        REASONING HISTORY
      </h2>

      {/* Filters */}
      <div style={{ ...card, marginBottom: 20, display: 'flex', gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginBottom: 4 }}>ASSET</div>
          <input style={inputStyle} placeholder="BTC/USD" value={filterAsset}
            onChange={e => setFilterAsset(e.target.value)} />
        </div>
        <div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginBottom: 4 }}>ACTION</div>
          <select style={{ ...inputStyle }} value={filterAction} onChange={e => setFilterAction(e.target.value)}>
            <option value="">All</option>
            <option value="buy">Buy</option>
            <option value="sell">Sell</option>
            <option value="hold">Hold</option>
          </select>
        </div>
        <div>
          <div style={{ fontSize: 10, fontFamily: 'var(--font-mono)', color: 'var(--muted)', marginBottom: 4 }}>OUTCOME</div>
          <select style={{ ...inputStyle }} value={filterOutcome} onChange={e => setFilterOutcome(e.target.value)}>
            <option value="">All</option>
            <option value="correct">Correct</option>
            <option value="incorrect">Incorrect</option>
          </select>
        </div>
        <button onClick={applyFilters} style={btn(true)}>Filter</button>
        <button onClick={() => { setFilterAsset(''); setFilterAction(''); setFilterOutcome(''); setPage(1) }}
          style={btn()}>Clear</button>
        <div style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)', alignSelf: 'center' }}>
          {total} trades
        </div>
      </div>

      {/* Table */}
      <div style={card}>
        {loading ? (
          <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 20 }}>Loading…</div>
        ) : trades.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 20 }}>No trades found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ color: 'var(--muted)' }}>
                  {['Timestamp', 'Asset', 'Action', 'Amount', 'Confidence', 'PnL', 'Correct', 'Reasoning', ''].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map(t => (
                  <tr key={t._id} style={{ borderBottom: '1px solid var(--border2)' }}>
                    <td style={{ padding: '7px 10px', whiteSpace: 'nowrap' }}>{new Date(t.timestamp).toLocaleString()}</td>
                    <td style={{ padding: '7px 10px' }}>{t.decision.asset.replace('/USD', '')}</td>
                    <td style={{ padding: '7px 10px', color: t.decision.action === 'buy' ? 'var(--green)' : t.decision.action === 'sell' ? 'var(--danger)' : 'var(--muted)', fontWeight: 600 }}>
                      {t.decision.action.toUpperCase()}
                    </td>
                    <td style={{ padding: '7px 10px' }}>${t.decision.amount_usd.toFixed(0)}</td>
                    <td style={{ padding: '7px 10px' }}>{(t.decision.confidence * 100).toFixed(0)}%</td>
                    <td style={{ padding: '7px 10px', color: t.outcome ? (t.outcome.pnl_usd >= 0 ? 'var(--green)' : 'var(--danger)') : 'var(--muted)' }}>
                      {t.outcome ? `${t.outcome.pnl_usd >= 0 ? '+' : ''}$${t.outcome.pnl_usd.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      {t.outcome ? (t.outcome.correct ? '✓' : '✗') : '—'}
                    </td>
                    <td style={{ padding: '7px 10px', maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'var(--muted)' }}>
                      {t.decision.reasoning}
                    </td>
                    <td style={{ padding: '7px 10px' }}>
                      <button onClick={() => setReplay(t)} style={{ ...btn(), padding: '3px 10px', fontSize: 10 }}>Replay</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16, alignItems: 'center' }}>
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)} style={{ ...btn(), padding: '4px 12px' }}>←</button>
            <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
              Page {page} / {totalPages}
            </span>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)} style={{ ...btn(), padding: '4px 12px' }}>→</button>
          </div>
        )}
      </div>

      {replay && <ReplayModal trade={replay} onClose={() => setReplay(null)} />}
    </div>
  )
}
