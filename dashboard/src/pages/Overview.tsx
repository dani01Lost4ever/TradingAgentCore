import { useEffect, useState, useCallback } from 'react'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { api } from '../api'
import type { Stats, Trade, AgentConfig } from '../api'
import { StatCard } from '../components/StatCard'
import { PendingCard } from '../components/PendingCard'
import { ActionBadge } from '../components/ActionBadge'
import { LogsPanel } from '../components/LogsPanel'
import { TrainingPanel } from '../components/TrainingPanel'

function fmt(ts: string) {
  return new Date(ts).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })
}

export function Overview() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [trades, setTrades] = useState<Trade[]>([])
  const [pending, setPending] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [config, setConfig] = useState<AgentConfig | null>(null)
  const [togglingAuto, setTogglingAuto] = useState(false)

  const load = useCallback(async () => {
    try {
      const [s, t, p, cfg] = await Promise.all([api.stats(), api.trades(1, 100), api.pending(), api.getConfig()])
      setStats(s)
      setTrades(t.trades)
      setPending(p)
      setConfig(cfg)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Auto-refresh every 60s
  useEffect(() => {
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [load])

  // Build cumulative P&L chart data from resolved trades
  const chartData = trades
    .filter(t => t.outcome)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .reduce<{ date: string; pnl: number }[]>((acc, t) => {
      const prev = acc.length ? acc[acc.length - 1].pnl : 0
      acc.push({ date: fmt(t.timestamp), pnl: parseFloat((prev + (t.outcome!.pnl_usd)).toFixed(2)) })
      return acc
    }, [])

  const pnlColor = stats && parseFloat(stats.total_pnl_usd) >= 0 ? 'var(--green)' : 'var(--danger)'

  if (loading) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:'60vh', fontFamily:'var(--font-mono)', color:'var(--muted)' }}>
      <span style={{ animation:'pulse 1.2s ease infinite' }}>LOADING SYSTEM DATA...</span>
    </div>
  )

  return (
    <div style={{ padding: '24px 28px', maxWidth: 1200, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', gap:14, marginBottom: 28 }}>
        <h1 style={{ fontFamily:'var(--font-mono)', fontSize:18, fontWeight:600, letterSpacing:'0.04em', color:'var(--accent)' }}>
          TRADING AGENT
        </h1>
        <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--muted)' }}>
          ● LIVE · {new Date().toLocaleTimeString()}
        </span>
        <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:10 }}>
          <span style={{ fontFamily:'var(--font-mono)', fontSize:11, color: config?.autoApprove ? 'var(--warn)' : 'var(--muted)' }}>
            {config?.autoApprove ? '🤖 AUTO-TRADE ON' : 'MANUAL APPROVAL'}
          </span>
          <button
            onClick={async () => {
              if (!config) return
              setTogglingAuto(true)
              try {
                const updated = await api.setConfig({ autoApprove: !config.autoApprove })
                setConfig(updated)
              } finally { setTogglingAuto(false) }
            }}
            disabled={togglingAuto || !config}
            title={config?.autoApprove ? 'Click to require manual approval before each trade' : 'Click to let the agent trade automatically'}
            style={{
              position: 'relative', width: 44, height: 24, borderRadius: 12, padding: 0,
              background: config?.autoApprove ? 'var(--warn)' : 'var(--bg3)',
              border: `1px solid ${config?.autoApprove ? 'var(--warn)' : 'var(--border2)'}`,
              transition: 'background 0.2s, border-color 0.2s',
              cursor: togglingAuto ? 'wait' : 'pointer',
            }}
          >
            <span style={{
              position: 'absolute', top: 3, left: config?.autoApprove ? 22 : 3,
              width: 16, height: 16, borderRadius: '50%',
              background: config?.autoApprove ? '#000' : 'var(--muted)',
              transition: 'left 0.2s',
              display: 'block',
            }} />
          </button>
        </div>
      </div>

      {/* Stats row */}
      {stats && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(160px,1fr))', gap:12, marginBottom:28 }}>
          <StatCard label="Total decisions" value={stats.total_decisions} />
          <StatCard label="Executed trades" value={stats.executed_trades} />
          <StatCard label="Win rate" value={`${stats.win_rate}%`} accent="accent" />
          <StatCard label="Total P&L" value={`$${stats.total_pnl_usd}`}
            accent={parseFloat(stats.total_pnl_usd) >= 0 ? 'green' : 'danger'} />
          <StatCard label="Dataset samples" value={stats.dataset_size} accent="accent2"
            sub="profitable trades logged" />
        </div>
      )}

      {/* Pending approvals */}
      {pending.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:12, color:'var(--warn)', letterSpacing:'0.08em', marginBottom:12 }}>
            ⚠ PENDING APPROVAL ({pending.length})
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px,1fr))', gap:12 }}>
            {pending.map(t => <PendingCard key={t._id} trade={t} onDone={load} />)}
          </div>
        </div>
      )}

      {/* P&L Chart */}
      {chartData.length > 1 && (
        <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:8, padding:20, marginBottom:28 }}>
          <div style={{ fontFamily:'var(--font-mono)', fontSize:11, color:'var(--muted)', letterSpacing:'0.08em', marginBottom:16 }}>
            CUMULATIVE P&L (USD)
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={chartData} margin={{ top:4, right:4, bottom:0, left:0 }}>
              <defs>
                <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={pnlColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={pnlColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontFamily:'var(--font-mono)', fontSize:10, fill:'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontFamily:'var(--font-mono)', fontSize:10, fill:'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={54} />
              <Tooltip
                contentStyle={{ background:'var(--bg3)', border:'1px solid var(--border2)', borderRadius:4, fontFamily:'var(--font-mono)', fontSize:11 }}
                labelStyle={{ color:'var(--muted)' }}
                itemStyle={{ color: pnlColor }}
                formatter={(v: any) => [`$${v}`, 'P&L']}
              />
              <ReferenceLine y={0} stroke="var(--border2)" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="pnl" stroke={pnlColor} strokeWidth={1.5} fill="url(#pnlGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Agent logs */}
      <div style={{ marginBottom: 28 }}>
        <LogsPanel />
      </div>

      {/* Fine-tuning pipeline */}
      <div style={{ marginBottom: 28 }}>
        <TrainingPanel />
      </div>

      {/* Trade log */}
      <div style={{ background:'var(--bg2)', border:'1px solid var(--border)', borderRadius:8, overflow:'hidden' }}>
        <div style={{ padding:'14px 20px', borderBottom:'1px solid var(--border)', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--muted)', letterSpacing:'0.08em' }}>
          DECISION LOG ({trades.length})
        </div>
        <div style={{ overflowX:'auto' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ borderBottom:'1px solid var(--border)' }}>
                {['Time','Action','Asset','Amount','Price','RSI','Confidence','P&L','Status'].map(h => (
                  <th key={h} style={{ padding:'10px 16px', textAlign:'left', fontFamily:'var(--font-mono)', fontSize:10, color:'var(--muted)', letterSpacing:'0.08em', fontWeight:400, whiteSpace:'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => {
                const snap = t.market[t.decision.asset]
                const pnl = t.outcome?.pnl_usd
                return (
                  <tr key={t._id} style={{
                    borderBottom:'1px solid var(--border)',
                    background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                    transition:'background 0.1s',
                  }}>
                    <td style={{ padding:'10px 16px', fontFamily:'var(--font-mono)', fontSize:11, color:'var(--muted)', whiteSpace:'nowrap' }}>{fmt(t.timestamp)}</td>
                    <td style={{ padding:'10px 16px' }}><ActionBadge action={t.decision.action} /></td>
                    <td style={{ padding:'10px 16px', fontFamily:'var(--font-mono)', fontSize:12, fontWeight:600 }}>{t.decision.asset}</td>
                    <td style={{ padding:'10px 16px', fontFamily:'var(--font-mono)', fontSize:12, color:'var(--accent)' }}>${t.decision.amount_usd.toLocaleString()}</td>
                    <td style={{ padding:'10px 16px', fontFamily:'var(--font-mono)', fontSize:12 }}>{snap ? `$${snap.price.toLocaleString()}` : '—'}</td>
                    <td style={{ padding:'10px 16px', fontFamily:'var(--font-mono)', fontSize:12, color: snap?.rsi_14 !== undefined ? (snap.rsi_14 > 70 ? 'var(--danger)' : snap.rsi_14 < 30 ? 'var(--green)' : 'var(--text)') : 'var(--muted)' }}>
                      {snap?.rsi_14 ?? '—'}
                    </td>
                    <td style={{ padding:'10px 16px', fontFamily:'var(--font-mono)', fontSize:12 }}>{(t.decision.confidence * 100).toFixed(0)}%</td>
                    <td style={{ padding:'10px 16px', fontFamily:'var(--font-mono)', fontSize:12, color: pnl === undefined ? 'var(--muted)' : pnl >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                      {pnl !== undefined ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                    </td>
                    <td style={{ padding:'10px 16px', fontFamily:'var(--font-mono)', fontSize:10, color: t.executed ? 'var(--green)' : t.approved ? 'var(--muted)' : t.decision.action === 'hold' ? 'var(--muted)' : 'var(--warn)' }}>
                      {t.executed ? 'EXECUTED' : t.approved ? 'REJECTED' : t.decision.action === 'hold' ? 'HOLD' : 'PENDING'}
                    </td>
                  </tr>
                )
              })}
              {trades.length === 0 && (
                <tr><td colSpan={9} style={{ padding:'40px 16px', textAlign:'center', fontFamily:'var(--font-mono)', fontSize:12, color:'var(--muted)' }}>
                  Waiting for first agent cycle...
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
