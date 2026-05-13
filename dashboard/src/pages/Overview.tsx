import { useEffect, useState, useCallback, useRef } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  PieChart, Pie, Cell, BarChart, Bar, ComposedChart, Line,
} from 'recharts'
import { api, getStatsPerPeriod } from '../api'
import type { Stats, Trade, AgentConfig, EquityPoint, PortfolioDetail, AssetPnl, RiskStatus, HealthStatus, BenchmarkPoint, AlpacaPosition, LogEntry } from '../api'
import { StatCard } from '../components/StatCard'
import { PendingCard } from '../components/PendingCard'
import { ActionBadge } from '../components/ActionBadge'
import { LogsPanel } from '../components/LogsPanel'
import { TrainingPanel } from '../components/TrainingPanel'
import { AllocationCard } from '../components/AllocationCard'
import { useSocket } from '../hooks/useSocket'
import { useActiveWallet } from '../hooks/useActiveWallet'

function fmt(ts: string) {
  return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function inferStrategyLabel(trade: Trade): string {
  if (trade.strategy_label) return trade.strategy_label
  if (trade.strategy_id) return trade.strategy_id.toUpperCase()
  const match = trade.decision.reasoning.match(/^\[Auto(?:->|→)([^\]]+)\]/i)
  if (match) return `Auto -> ${match[1].trim()}`
  return '—'
}

const PIE_COLORS = [
  'var(--accent)', 'var(--accent2)', 'var(--green)', 'var(--warn)', 'var(--danger)',
  '#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#a4de6c',
]

function isAuroraDark(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'aurora-dark'
}

// ── browser push notifications ─────────────────────────────────────────────
function requestNotifPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission()
  }
}

function sendNotif(title: string, body: string) {
  if ('Notification' in window && Notification.permission === 'granted') {
    new Notification(title, { body, icon: '/favicon.ico' })
  }
}

// ── Health widget ──────────────────────────────────────────────────────────
function HealthWidget({ health }: { health: HealthStatus }) {
  const aurora = isAuroraDark()
  const services: { label: string; ok: boolean }[] = [
    { label: 'MongoDB',   ok: health.mongodb },
    { label: 'Anthropic', ok: health.anthropicKeySet },
    { label: 'OpenAI',    ok: health.openaiKeySet },
    { label: 'Alpaca',    ok: health.alpacaKeySet },
  ]

  const lastCycleText = (() => {
    if (!health.lastCycleAt) return null
    const diff = Date.now() - new Date(health.lastCycleAt).getTime()
    const mins = Math.floor(diff / 60_000)
    return mins < 60 ? `${mins}m ago` : `${Math.floor(mins / 60)}h ${mins % 60}m ago`
  })()

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '6px 12px',
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      marginBottom: 20,
    }}>
      <span style={{
        fontFamily: aurora ? 'var(--font-sans)' : 'var(--font-mono)',
        fontSize: 10,
        fontWeight: aurora ? 600 : 400,
        color: 'var(--muted)',
        letterSpacing: aurora ? '0.11em' : '0.08em',
        textTransform: 'uppercase',
      }}>
        Health
      </span>
      {services.map(s => (
        <span key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 10 }}>
          <span style={{ width: 5, height: 5, borderRadius: '50%', background: s.ok ? 'var(--green)' : 'var(--danger)', display: 'inline-block', flexShrink: 0 }} />
          <span style={{ color: s.ok ? 'var(--text)' : 'var(--muted)' }}>{s.label}</span>
        </span>
      ))}
      {lastCycleText && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginLeft: 8 }}>
          Last cycle: <span style={{ color: 'var(--text)' }}>{lastCycleText}</span>
        </span>
      )}
      <span style={{
        marginLeft: 'auto', fontFamily: 'var(--font-mono)', fontSize: 10,
        color: health.status === 'ok' ? 'var(--green)' : 'var(--warn)',
      }}>
        {health.status === 'ok' ? '● OK' : '◌ DEGRADED'}
      </span>
    </div>
  )
}

// ── Trade Replay Modal ─────────────────────────────────────────────────────
function TradeReplayModal({ trade, onClose }: { trade: Trade; onClose: () => void }) {
  const aurora = isAuroraDark()
  const snap = trade.market[trade.decision.asset]
  const indicators: { label: string; value: string | number }[] = snap ? [
    { label: 'Price',     value: `$${snap.price.toLocaleString()}` },
    { label: 'RSI 14',    value: snap.rsi_14 ?? '—' },
    { label: 'Change 24h', value: snap.change_24h !== undefined ? `${snap.change_24h >= 0 ? '+' : ''}${snap.change_24h.toFixed(2)}%` : '—' },
    { label: 'Volume 24h', value: snap.volume_24h !== undefined ? snap.volume_24h.toLocaleString(undefined, { maximumFractionDigits: 0 }) : '—' },
  ] : []

  const barData = snap ? [
    { name: 'RSI', value: snap.rsi_14 ?? 0 },
    { name: 'Confidence', value: trade.decision.confidence * 100 },
  ] : []

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.72)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg2)',
          border: '1px solid var(--border)',
          padding: 28,
          maxWidth: 520,
          width: '100%',
          margin: '0 16px',
          maxHeight: '80vh',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ActionBadge action={trade.decision.action} />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>
              {trade.decision.asset}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
              {fmt(trade.timestamp)}
            </span>
          </div>
          <button onClick={onClose} style={{
            background: 'transparent', border: 'none', color: 'var(--muted)', fontSize: 18,
            cursor: 'pointer', lineHeight: 1, padding: '0 4px',
          }}>x</button>
        </div>

        {/* Details grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', marginBottom: 16 }}>
          {[
            { label: 'Amount', value: `$${trade.decision.amount_usd.toLocaleString()}` },
            { label: 'Confidence', value: `${(trade.decision.confidence * 100).toFixed(0)}%` },
            ...(trade.outcome ? [
              { label: 'P&L', value: `${trade.outcome.pnl_usd >= 0 ? '+' : ''}$${trade.outcome.pnl_usd.toFixed(2)}` },
              { label: 'Outcome', value: trade.outcome.correct ? 'Correct' : 'Incorrect' },
            ] : []),
            ...indicators,
          ].map(({ label, value }) => (
            <div key={label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontFamily: aurora ? 'var(--font-sans)' : 'var(--font-mono)',
                fontSize: 9,
                fontWeight: aurora ? 600 : 400,
                color: 'var(--muted)',
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}>{label}</span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                color: 'var(--text)',
                fontVariantNumeric: 'tabular-nums',
              }}>{String(value)}</span>
            </div>
          ))}
        </div>

        {/* Mini bar chart */}
        {barData.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{
              fontFamily: aurora ? 'var(--font-sans)' : 'var(--font-mono)',
              fontSize: 10,
              fontWeight: aurora ? 600 : 400,
              color: 'var(--muted)',
              marginBottom: 8,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              Indicator Snapshot
            </div>
            <ResponsiveContainer width="100%" height={80}>
              <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={72} />
                <Bar dataKey="value" radius={aurora ? [0, 2, 2, 0] : [0, 3, 3, 0]}>
                  {barData.map((d, i) => (
                    <Cell key={i} fill={d.value >= 70 ? 'var(--danger)' : d.value >= 50 ? 'var(--accent)' : 'var(--green)'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Reasoning */}
        <div>
          <div style={{
            fontFamily: aurora ? 'var(--font-sans)' : 'var(--font-mono)',
            fontSize: 10,
            fontWeight: aurora ? 600 : 400,
            color: 'var(--muted)',
            marginBottom: 8,
            letterSpacing: '0.06em',
            textTransform: 'uppercase',
          }}>
            Reasoning
          </div>
          <div style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--text)',
            background: 'var(--bg3)',
            border: '1px solid var(--border)',
            padding: '10px 14px',
            lineHeight: 1.7,
            maxHeight: 180,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
          }}>
            {trade.decision.reasoning || '—'}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Section title helper ───────────────────────────────────────────────────
function SectionTitle({ children }: { children: React.ReactNode }) {
  const aurora = isAuroraDark()
  if (aurora) {
    return <div className="aurora-section-title">{children}</div>
  }
  return (
    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 12 }}>
      {String(children).toUpperCase()}
    </div>
  )
}

// ── Panel wrapper ──────────────────────────────────────────────────────────
function Panel({ children, style, fadeClass }: { children: React.ReactNode; style?: React.CSSProperties; fadeClass?: string }) {
  const aurora = isAuroraDark()
  return (
    <div
      className={aurora && fadeClass ? `aurora-card ${fadeClass}` : undefined}
      style={{
        background: 'var(--bg2)',
        border: '1px solid var(--border)',
        padding: aurora ? '20px 22px' : 20,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────
export function Overview() {
  const [stats, setStats]           = useState<Stats | null>(null)
  const [trades, setTrades]         = useState<Trade[]>([])
  const [pending, setPending]       = useState<Trade[]>([])
  const [config, setConfig]         = useState<AgentConfig | null>(null)
  const [equity, setEquity]         = useState<EquityPoint[]>([])
  const [benchmark, setBenchmark]   = useState<BenchmarkPoint[]>([])
  const [portfolio, setPortfolio]   = useState<PortfolioDetail | null>(null)
  const [perAsset, setPerAsset]     = useState<AssetPnl[]>([])
  const [risk, setRisk]             = useState<RiskStatus | null>(null)
  const [health, setHealth]         = useState<HealthStatus | null>(null)
  const [loading, setLoading]       = useState(true)
  const [togglingAuto, setTogglingAuto] = useState(false)
  const [wsStatus, setWsStatus]     = useState<'connecting' | 'live' | 'reconnecting'>('connecting')
  const [replayTrade, setReplayTrade] = useState<Trade | null>(null)
  const lastTradeIdRef              = useRef<string | null>(null)

  // Positions
  const [positions, setPositions]   = useState<AlpacaPosition[] | null>(null)
  const [posLoading, setPosLoading] = useState(true)

  // Pause/resume
  const [agentPaused, setAgentPaused] = useState(false)
  const [pauseLoading, setPauseLoading] = useState(false)

  // Live logs
  const [liveLogs, setLiveLogs]       = useState<LogEntry[]>([])
  const [logsOpen, setLogsOpen]       = useState(true)

  // Wallet mode (for live banner) — driven by useActiveWallet hook
  const { wallet: activeWalletData, refresh: refreshActiveWallet } = useActiveWallet()
  const walletMode      = activeWalletData?.mode ?? 'paper'
  const activeWalletId  = activeWalletData?.id ?? null
  const activeWalletName = activeWalletData?.name ?? ''

  // Period P&L
  const [pnlPeriod, setPnlPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [periodPnl, setPeriodPnl] = useState<Array<{ period: string; total_pnl: number; trade_count: number; win_rate: number; avg_win: number | null; avg_loss: number | null }>>([])

  // ── data loaders ──────────────────────────────────────────────────────────
  const loadCore = useCallback(async () => {
    // Clear stale data immediately so user doesn't see the previous wallet's numbers
    setPositions(null)
    setPortfolio(null)
    setPerAsset([])
    setEquity([])
    setPeriodPnl([])
    try {
      const wid = activeWalletId ?? undefined
      const [s, t, p, cfg, eq, port, pa, rs] = await Promise.all([
        api.stats(wid),
        api.trades(1, 100, wid),
        api.pending(),
        api.getConfig(),
        api.equityHistory(200, wid),
        api.portfolioDetail().catch(() => null),
        api.perAssetPnl(wid),
        api.riskStatus().catch(() => null),
      ])
      setStats(s)
      setTrades(t.trades)
      setPending(p.filter(x => !x.execution_error))
      setConfig(cfg)
      setEquity(eq)
      if (port) setPortfolio(port)
      setPerAsset(pa)
      if (rs) setRisk(rs)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [activeWalletId])

  useEffect(() => {
    requestNotifPermission()
    loadCore()
    // Load health and benchmark (non-critical)
    api.health().then(setHealth).catch(() => {})
    api.benchmark().then(d => setBenchmark(d.points)).catch(() => {})

    // Agent status
    api.agentStatus().then(s => setAgentPaused(s.paused)).catch(() => {})

    // Initial live logs
    api.agentLogs(200).then(r => setLiveLogs(r.logs.slice().reverse())).catch(() => {})
      .finally(() => {})

    // Positions
    api.positions().then(p => setPositions(p)).catch(() => setPositions([]))
      .finally(() => setPosLoading(false))
  }, [loadCore])

  // Refresh everything every 90s as a safety net (WS covers live updates)
  useEffect(() => {
    const id = setInterval(loadCore, 90_000)
    return () => clearInterval(id)
  }, [loadCore])

  // Refresh positions every 60s
  useEffect(() => {
    const id = setInterval(() => {
      api.positions().then(setPositions).catch(() => {})
    }, 60_000)
    return () => clearInterval(id)
  }, [])

  // Fetch period P&L when period changes
  useEffect(() => {
    getStatsPerPeriod(pnlPeriod, activeWalletId ?? undefined).then(setPeriodPnl).catch(() => {})
  }, [pnlPeriod, activeWalletId])


  // ── WebSocket live updates ─────────────────────────────────────────────
  useSocket(useCallback((ev) => {
    if (ev.type === 'connected') {
      setWsStatus('live')
    }
    if ((ev as any).type === 'wallet:switched') {
      // Server pushed a wallet switch — refresh active wallet data and reload core stats
      refreshActiveWallet()
      loadCore()
      return
    }
    if (ev.type === 'log_line') {
      const entry = ev.data as LogEntry
      setLiveLogs(prev => [...prev, entry].slice(-300))
    }
    if (ev.type === 'portfolio') {
      api.portfolioDetail().then(setPortfolio).catch(() => {})
    }
    if (ev.type === 'trade:new') {
      const trade = ev.data as Trade
      setTrades(prev => [trade, ...prev].slice(0, 100))
      if (trade.decision.action !== 'hold' && !trade.approved && !trade.execution_error && (trade.approval_mode ?? 'manual') === 'manual') {
        setPending(prev => [trade, ...prev.filter(p => p._id !== trade._id)])
        sendNotif(
          `New ${trade.decision.action.toUpperCase()} signal`,
          `${trade.decision.asset} · $${trade.decision.amount_usd.toLocaleString()} · ${(trade.decision.confidence * 100).toFixed(0)}% confidence`,
        )
      }
    }
    if (ev.type === 'trade:executed') {
      const trade = ev.data as Trade
      setTrades(prev => prev.map(t => t._id === trade._id ? trade : t))
      setPending(prev => prev.filter(p => p._id !== trade._id))
      if (lastTradeIdRef.current !== trade._id) {
        lastTradeIdRef.current = trade._id
        sendNotif(
          `Trade executed: ${trade.decision.action.toUpperCase()} ${trade.decision.asset}`,
          `$${trade.decision.amount_usd.toLocaleString()} @ ~$${trade.market[trade.decision.asset]?.price.toLocaleString() ?? '?'}`,
        )
      }
      Promise.all([api.stats(), api.equityHistory(200), api.perAssetPnl()]).then(([s, eq, pa]) => {
        setStats(s)
        setEquity(eq)
        setPerAsset(pa)
      }).catch(() => {})
    }
  }, [refreshActiveWallet, loadCore]))

  // ── chart data ─────────────────────────────────────────────────────────
  const cumulativePnl = trades
    .filter(t => t.outcome)
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
    .reduce<{ date: string; pnl: number }[]>((acc, t) => {
      const prev = acc.length ? acc[acc.length - 1].pnl : 0
      acc.push({ date: fmt(t.timestamp), pnl: parseFloat((prev + t.outcome!.pnl_usd).toFixed(2)) })
      return acc
    }, [])

  const pnlColor = stats && parseFloat(stats.total_pnl_usd) >= 0 ? 'var(--green)' : 'var(--danger)'

  // Build a lookup for benchmark by ts prefix (date+hour) for merging
  const benchmarkMap = new Map<string, number>()
  benchmark.forEach(b => benchmarkMap.set(b.ts, b.benchmark))

  // Equity / drawdown chart — merge benchmark points
  const equityChartData = equity.map((e, i) => {
    const tsKey = e.ts
    // Try exact match first, then use indexed fallback from benchmark array
    const bm = benchmarkMap.get(tsKey) ?? benchmark[i]?.benchmark ?? undefined
    return {
      ts: new Date(e.ts).toLocaleString('en-GB', { month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
      equity: parseFloat(e.equity.toFixed(2)),
      peak: parseFloat(e.peak.toFixed(2)),
      drawdown: parseFloat(((e.equity - e.peak) / e.peak * 100).toFixed(2)),
      benchmark: bm !== undefined ? parseFloat(bm.toFixed(2)) : undefined,
    }
  })

  // Portfolio pie
  const pieData: { name: string; value: number }[] = []
  if (portfolio) {
    if (portfolio.cash > 0) pieData.push({ name: 'Cash', value: parseFloat(portfolio.cash.toFixed(2)) })
    ;(portfolio.positions ?? []).forEach(p => pieData.push({ name: p.asset, value: parseFloat(p.market_value.toFixed(2)) }))
  }

  // Per-asset bar
  const barData = perAsset.map(a => ({ asset: a.asset.replace('/USD', ''), pnl: a.total_pnl, wins: a.win_rate }))
  const failedTrades = trades.filter(t => !!t.execution_error)

  const aurora = isAuroraDark()

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60vh', fontFamily: 'var(--font-mono)', color: 'var(--muted)' }}>
      <span style={{ animation: 'pulse 1.2s ease infinite' }}>LOADING SYSTEM DATA...</span>
    </div>
  )

  return (
    <div style={{ padding: aurora ? '28px 28px 40px' : '24px 28px', maxWidth: aurora ? 1400 : 1200, margin: '0 auto' }}>

      {/* ── Live trading warning ── */}
      {walletMode === 'live' && (
        <div style={{
          background: aurora ? 'rgba(217,79,61,0.08)' : 'var(--danger)',
          color: aurora ? 'var(--danger)' : 'white',
          border: aurora ? '1px solid rgba(217,79,61,0.3)' : 'none',
          textAlign: 'center' as const,
          padding: '8px 16px',
          fontFamily: aurora ? 'var(--font-sans)' : 'inherit',
          fontWeight: 600,
          fontSize: aurora ? '0.72rem' : '14px',
          letterSpacing: aurora ? '0.08em' : '0.05em',
          textTransform: 'uppercase',
          marginBottom: aurora ? 20 : 0,
        }}>
          LIVE TRADING ACTIVE — Real funds at risk
        </div>
      )}

      {/* ── Hero equity number (aurora-dark only) ── */}
      {aurora && portfolio && (
        <div className="aurora-card aurora-fade-1" style={{ marginBottom: 20, padding: '20px 24px' }}>
          <div style={{
            fontFamily: 'var(--font-sans)',
            fontSize: '0.62rem',
            fontWeight: 600,
            letterSpacing: '0.13em',
            textTransform: 'uppercase',
            color: 'var(--muted)',
            marginBottom: 6,
          }}>
            portfolio equity
          </div>
          <div className="equity-hero-number aurora-tnum" style={{ fontSize: 96 }}>
            ${portfolio.equity.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </div>
          {stats && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '1rem',
                fontWeight: 600,
                color: parseFloat(stats.total_pnl_usd) >= 0 ? 'var(--accent)' : 'var(--danger)',
                fontVariantNumeric: 'tabular-nums',
                letterSpacing: '-0.02em',
              }}>
                {parseFloat(stats.total_pnl_usd) >= 0 ? '+' : ''}${stats.total_pnl_usd}
              </span>
              <span style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.78rem',
                color: 'var(--muted)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                — net p&amp;l
              </span>
            </div>
          )}
        </div>
      )}

      {/* ── Header (non-aurora) ── */}
      {!aurora && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
          <h1 style={{ fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--accent)' }}>
            TRADING AGENT{activeWalletName ? ` — ${activeWalletName}` : ''}
          </h1>
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: wsStatus === 'live' ? 'var(--green)' : wsStatus === 'reconnecting' ? 'var(--warn)' : 'var(--muted)',
          }}>
            {wsStatus === 'live' ? '● LIVE' : wsStatus === 'reconnecting' ? '◌ RECONNECTING' : '○ CONNECTING'}
            {' · '}{new Date().toLocaleTimeString()}
          </span>

          {risk?.circuitBreakerActive && (
            <span style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)',
              background: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)',
              padding: '2px 8px', letterSpacing: '0.06em',
            }}>
              CIRCUIT BREAKER · {risk.circuitBreakerReason}
            </span>
          )}

          <button
            onClick={async () => {
              setPauseLoading(true)
              try {
                const r = agentPaused ? await api.resumeAgent() : await api.pauseAgent()
                setAgentPaused(r.paused)
              } finally { setPauseLoading(false) }
            }}
            disabled={pauseLoading}
            style={{
              padding: '5px 14px',
              fontFamily: 'var(--font-mono)', fontSize: 11, letterSpacing: '0.06em',
              background: agentPaused ? 'rgba(239,68,68,0.12)' : 'rgba(var(--accent-rgb,0,212,170),0.1)',
              color: agentPaused ? 'var(--danger)' : 'var(--accent)',
              border: `1px solid ${agentPaused ? 'var(--danger)' : 'var(--accent)'}`,
              cursor: pauseLoading ? 'wait' : 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {agentPaused ? 'Resume' : 'Pause'}
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: config?.autoApprove ? 'var(--warn)' : 'var(--muted)' }}>
              {config?.autoApprove ? 'AUTO-TRADE ON' : 'MANUAL APPROVAL'}
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
              title={config?.autoApprove ? 'Click to require manual approval' : 'Click to let agent trade automatically'}
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
                transition: 'left 0.2s', display: 'block',
              }} />
            </button>
          </div>
        </div>
      )}

      {/* ── Aurora: agent controls bar ── */}
      {aurora && (
        <div className="aurora-fade-2" style={{
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          marginBottom: 20,
          padding: '0 4px 16px 4px',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            color: wsStatus === 'live' ? 'var(--accent)' : wsStatus === 'reconnecting' ? 'var(--warn)' : 'var(--muted)',
            display: 'flex', alignItems: 'center', gap: 5,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: '50%',
              background: wsStatus === 'live' ? 'var(--accent)' : wsStatus === 'reconnecting' ? 'var(--warn)' : 'var(--muted)',
              display: 'inline-block',
              animation: wsStatus === 'live' ? 'pulse 2s ease-in-out infinite' : 'none',
            }} />
            {wsStatus === 'live' ? 'WS LIVE' : wsStatus === 'reconnecting' ? 'RECONNECTING' : 'CONNECTING'}
          </span>

          {activeWalletName && (
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', color: 'var(--muted)' }}>
              {activeWalletName}
            </span>
          )}

          {risk?.circuitBreakerActive && (
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: '0.65rem', fontWeight: 700,
              color: 'var(--danger)', letterSpacing: '0.08em',
              border: '1px solid rgba(217,79,61,0.3)', padding: '2px 8px',
              textTransform: 'uppercase',
            }}>
              Circuit Breaker · {risk.circuitBreakerReason}
            </span>
          )}

          <button
            onClick={async () => {
              setPauseLoading(true)
              try {
                const r = agentPaused ? await api.resumeAgent() : await api.pauseAgent()
                setAgentPaused(r.paused)
              } finally { setPauseLoading(false) }
            }}
            disabled={pauseLoading}
            style={{
              padding: '5px 14px',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.65rem',
              fontWeight: 600,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              background: agentPaused ? 'rgba(217,79,61,0.08)' : 'transparent',
              color: agentPaused ? 'var(--danger)' : 'var(--muted)',
              border: `1px solid ${agentPaused ? 'rgba(217,79,61,0.3)' : 'var(--border)'}`,
              borderRadius: 2,
              cursor: pauseLoading ? 'wait' : 'pointer',
              transition: 'all 0.15s ease-out',
            }}
          >
            {agentPaused ? 'Resume' : 'Pause'}
          </button>

          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: '0.65rem', fontWeight: 600,
              color: config?.autoApprove ? 'var(--warn)' : 'var(--muted)',
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              {config?.autoApprove ? 'Auto-Trade On' : 'Manual Approval'}
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
              title={config?.autoApprove ? 'Click to require manual approval' : 'Click to let agent trade automatically'}
              style={{
                position: 'relative', width: 40, height: 22, borderRadius: 2, padding: 0,
                background: config?.autoApprove ? 'var(--warn)' : 'var(--bg3)',
                border: `1px solid ${config?.autoApprove ? 'var(--warn)' : 'var(--border)'}`,
                transition: 'background 0.2s, border-color 0.2s',
                cursor: togglingAuto ? 'wait' : 'pointer',
              }}
            >
              <span style={{
                position: 'absolute', top: 3, left: config?.autoApprove ? 20 : 3,
                width: 14, height: 14, borderRadius: 1,
                background: config?.autoApprove ? '#08090B' : 'var(--muted)',
                transition: 'left 0.2s', display: 'block',
              }} />
            </button>
          </div>
        </div>
      )}

      {/* ── Health widget ── */}
      {health && <HealthWidget health={health} />}

      {/* ── Stats row ── */}
      {stats && (
        aurora ? (
          <div
            className="aurora-stat-row aurora-fade-2"
            style={{
              gridTemplateColumns: `repeat(${risk ? 6 : 5}, 1fr)`,
              marginBottom: 20,
            }}
          >
            <StatCard label="Total decisions" value={stats.total_decisions} />
            <StatCard label="Executed trades" value={stats.executed_trades} />
            <StatCard label="Win rate" value={`${stats.win_rate}%`} accent="accent" />
            <StatCard label="Total P&L" value={`$${stats.total_pnl_usd}`}
              accent={parseFloat(stats.total_pnl_usd) >= 0 ? 'green' : 'danger'} />
            {risk && (
              <StatCard label="Open positions" value={`${risk.openPositions} / ${risk.maxOpenPositions}`}
                accent={risk.openPositions >= risk.maxOpenPositions ? 'danger' : 'accent'} />
            )}
            <StatCard label="Dataset samples" value={stats.dataset_size} accent="accent2" sub="profitable trades" />
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(155px,1fr))', gap: 12, marginBottom: 28 }}>
            <StatCard label="Total decisions" value={stats.total_decisions} />
            <StatCard label="Executed trades" value={stats.executed_trades} />
            <StatCard label="Win rate" value={`${stats.win_rate}%`} accent="accent" />
            <StatCard label="Total P&L" value={`$${stats.total_pnl_usd}`}
              accent={parseFloat(stats.total_pnl_usd) >= 0 ? 'green' : 'danger'} />
            {risk && (
              <StatCard label="Open positions" value={`${risk.openPositions} / ${risk.maxOpenPositions}`}
                accent={risk.openPositions >= risk.maxOpenPositions ? 'danger' : 'accent'} />
            )}
            <StatCard label="Dataset samples" value={stats.dataset_size} accent="accent2" sub="profitable trades" />
          </div>
        )
      )}

      {/* ── Pending approvals ── */}
      {pending.length > 0 && (
        <div style={{ marginBottom: aurora ? 20 : 28 }} className={aurora ? 'aurora-fade-3' : undefined}>
          {aurora ? (
            <div style={{
              border: '1px solid var(--border-accent)',
              background: 'var(--accent-glow)',
              padding: '12px 18px',
              marginBottom: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}>
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontSize: '0.6rem',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                color: 'var(--accent)',
                border: '1px solid var(--border-accent)',
                padding: '2px 6px',
              }}>
                pending
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--muted)' }}>
                {pending.length} approval{pending.length > 1 ? 's' : ''} waiting
              </span>
            </div>
          ) : (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--warn)', letterSpacing: '0.08em', marginBottom: 12 }}>
              PENDING APPROVAL ({pending.length})
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px,1fr))', gap: 12 }}>
            {pending.map(t => <PendingCard key={t._id} trade={t} onDone={loadCore} />)}
          </div>
        </div>
      )}

      {/* ── Alpaca Positions panel ── */}
      <Panel style={{ marginBottom: aurora ? 20 : 28 }} fadeClass="aurora-fade-4">
        <SectionTitle>Open Positions</SectionTitle>
        {posLoading ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading positions...</div>
        ) : !positions || positions.length === 0 ? (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>No open positions</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table
              className={aurora ? 'aurora-table' : undefined}
              style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}
            >
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['Asset', 'Side', 'Qty', 'Entry Price', 'Current Price', 'Market Value', 'Unrealized P&L', 'P&L %'].map(h => (
                    <th key={h} style={{
                      padding: aurora ? '0 12px 10px 0' : '6px 12px',
                      textAlign: 'left',
                      fontFamily: aurora ? 'var(--font-sans)' : 'var(--font-mono)',
                      fontSize: 10,
                      color: 'var(--muted)',
                      letterSpacing: aurora ? '0.11em' : '0.06em',
                      fontWeight: aurora ? 600 : 400,
                      whiteSpace: 'nowrap',
                      textTransform: 'uppercase',
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map(pos => {
                  const pl = parseFloat(pos.unrealized_pl)
                  const plPct = parseFloat(pos.unrealized_plpc) * 100
                  const plColor = pl >= 0 ? 'var(--green)' : 'var(--danger)'
                  return (
                    <tr key={pos.symbol} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: aurora ? '10px 12px 10px 0' : '7px 12px', color: 'var(--text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pos.symbol}</td>
                      <td style={{ padding: aurora ? '10px 12px 10px 0' : '7px 12px' }}>
                        <ActionBadge action={pos.side === 'long' ? 'buy' : 'sell'} />
                      </td>
                      <td style={{ padding: aurora ? '10px 12px 10px 0' : '7px 12px', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>{parseFloat(pos.qty).toFixed(6)}</td>
                      <td style={{ padding: aurora ? '10px 12px 10px 0' : '7px 12px', color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>${parseFloat(pos.avg_entry_price).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td style={{ padding: aurora ? '10px 12px 10px 0' : '7px 12px', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>${parseFloat(pos.current_price).toLocaleString(undefined, { maximumFractionDigits: 4 })}</td>
                      <td style={{ padding: aurora ? '10px 12px 10px 0' : '7px 12px', color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>${parseFloat(pos.market_value).toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                      <td style={{ padding: aurora ? '10px 12px 10px 0' : '7px 12px', color: plColor, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{pl >= 0 ? '+' : ''}${pl.toFixed(2)}</td>
                      <td style={{ padding: aurora ? '10px 12px 10px 0' : '7px 12px', color: plColor, fontVariantNumeric: 'tabular-nums' }}>{plPct >= 0 ? '+' : ''}{plPct.toFixed(2)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <AllocationCard />

      {/* ── Portfolio + Per-asset row ── */}
      {(pieData.length > 0 || perAsset.length > 0) && (
        <div style={{ display: 'grid', gridTemplateColumns: pieData.length > 0 && perAsset.length > 0 ? '1fr 1fr' : '1fr', gap: aurora ? 20 : 16, marginBottom: aurora ? 20 : 28 }}>

          {/* Portfolio Pie */}
          {pieData.length > 0 && (
            <Panel fadeClass="aurora-fade-5">
              <SectionTitle>Portfolio Breakdown</SectionTitle>
              {portfolio && (
                <div style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  color: 'var(--muted)',
                  marginBottom: 12,
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  Equity: <span style={{ color: 'var(--accent)' }}>${portfolio.equity.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                </div>
              )}
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={pieData} cx="50%" cy="50%"
                    innerRadius={52} outerRadius={82}
                    dataKey="value" nameKey="name"
                    paddingAngle={2}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} stroke="var(--bg2)" strokeWidth={2} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}
                    formatter={(v: any, _name: any, props: any) => [
                      `$${Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`,
                      props.payload.name,
                    ]}
                  />
                </PieChart>
              </ResponsiveContainer>

              {/* Custom legend */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 16px', marginTop: 4 }}>
                {pieData.map((d, i) => {
                  const total = pieData.reduce((s, x) => s + x.value, 0)
                  const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0'
                  return (
                    <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ width: 8, height: 8, borderRadius: aurora ? 1 : '50%', background: PIE_COLORS[i % PIE_COLORS.length], flexShrink: 0, display: 'inline-block' }} />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                        {d.name} <span style={{ color: 'var(--text)' }}>{pct}%</span>
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Positions table */}
              {portfolio && portfolio.positions.length > 0 && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                  {portfolio.positions.map(p => (
                    <div key={p.asset} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', borderBottom: '1px solid var(--border)', fontSize: 11, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
                      <span style={{ color: 'var(--text)', fontWeight: 700 }}>{p.asset}</span>
                      <span style={{ color: 'var(--muted)' }}>{p.qty.toFixed(6)} @ ${p.entry_price.toLocaleString()}</span>
                      <span style={{ color: p.unrealized_pl >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                        {p.unrealized_pl >= 0 ? '+' : ''}{p.unrealized_plpc.toFixed(2)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>
          )}

          {/* Per-asset P&L */}
          {perAsset.length > 0 && (
            <Panel fadeClass="aurora-fade-5">
              <SectionTitle>Per-Asset P&amp;L</SectionTitle>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={barData} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }}>
                  <XAxis type="number" tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} />
                  <YAxis type="category" dataKey="asset" tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} width={42} />
                  <Tooltip
                    contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}
                    formatter={(v: any, name: string) => name === 'pnl' ? [`$${Number(v).toFixed(2)}`, 'P&L'] : [`${Number(v).toFixed(1)}%`, 'Win rate']}
                  />
                  <ReferenceLine x={0} stroke="var(--border)" />
                  <Bar dataKey="pnl" radius={aurora ? [0, 2, 2, 0] : [0, 3, 3, 0]}>
                    {barData.map((d, i) => (
                      <Cell key={i} fill={d.pnl >= 0 ? 'var(--green)' : 'var(--danger)'} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>

              {/* Per-asset stats table */}
              <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                {perAsset.map(a => (
                  <div key={a.asset} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 11, fontFamily: 'var(--font-mono)', borderBottom: '1px solid var(--border)', fontVariantNumeric: 'tabular-nums' }}>
                    <span style={{ color: 'var(--text)', fontWeight: 700 }}>{a.asset}</span>
                    <span style={{ color: 'var(--muted)' }}>{a.trade_count} trades · {a.win_rate.toFixed(1)}% win</span>
                    <span style={{ color: a.total_pnl >= 0 ? 'var(--green)' : 'var(--danger)' }}>
                      {a.total_pnl >= 0 ? '+' : ''}${a.total_pnl.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </Panel>
          )}
        </div>
      )}

      {/* ── Equity curve + Drawdown ── */}
      {equityChartData.length > 1 && (
        <Panel style={{ marginBottom: aurora ? 20 : 28 }} fadeClass="aurora-fade-5">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
            <SectionTitle>Equity Curve &amp; Drawdown</SectionTitle>
            {benchmark.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
                <span style={{ width: 16, height: 1, background: 'var(--muted)', display: 'inline-block', opacity: 0.6 }} />
                BTC B&H
              </div>
            )}
          </div>
          {/* Equity vs peak + benchmark */}
          <div style={{ marginBottom: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>Equity ($)</div>
          <ResponsiveContainer width="100%" height={130}>
            <ComposedChart data={equityChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="eqGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--accent)" stopOpacity={aurora ? 0.08 : 0.3} />
                  <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="ts" tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v.toLocaleString()}`} width={68} />
              <Tooltip
                contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text)' }}
                formatter={(v: any, name: string) => {
                  if (name === 'benchmark') return [`$${Number(v).toLocaleString()}`, 'BTC B&H']
                  return [`$${Number(v).toLocaleString()}`, name === 'equity' ? 'Equity' : 'Peak']
                }}
              />
              <Area type="monotone" dataKey="peak" stroke="var(--border)" strokeWidth={1} fill="none" strokeDasharray="4 2" dot={false} />
              <Area type="monotone" dataKey="equity" stroke="var(--accent)" strokeWidth={aurora ? 1.8 : 1.5} fill="url(#eqGrad)" dot={false} />
              {benchmark.length > 0 && (
                <Line type="monotone" dataKey="benchmark" stroke="var(--muted)" strokeWidth={1} dot={false} strokeDasharray="4 2" connectNulls strokeOpacity={0.6} />
              )}
            </ComposedChart>
          </ResponsiveContainer>

          {/* Drawdown % */}
          <div style={{ marginTop: 16, marginBottom: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>Drawdown (%)</div>
          <ResponsiveContainer width="100%" height={80}>
            <AreaChart data={equityChartData} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="ddGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--danger)" stopOpacity={aurora ? 0.2 : 0.4} />
                  <stop offset="100%" stopColor="var(--danger)" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <XAxis dataKey="ts" tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 9, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `${v}%`} width={40} />
              <Tooltip
                contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--text)' }}
                formatter={(v: any) => [`${Number(v).toFixed(2)}%`, 'Drawdown']}
              />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Area type="monotone" dataKey="drawdown" stroke="var(--danger)" strokeWidth={aurora ? 1.4 : 1.5} fill="url(#ddGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      )}

      {/* ── Cumulative P&L ── */}
      {cumulativePnl.length > 1 && (
        <Panel style={{ marginBottom: aurora ? 20 : 28 }} fadeClass="aurora-fade-6">
          <SectionTitle>Cumulative P&amp;L (USD)</SectionTitle>
          <ResponsiveContainer width="100%" height={160}>
            <AreaChart data={cumulativePnl} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="pnlGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={pnlColor} stopOpacity={0.25} />
                  <stop offset="100%" stopColor={pnlColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={{ fontFamily: 'var(--font-mono)', fontSize: 10, fill: 'var(--muted)' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v}`} width={54} />
              <Tooltip
                contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}
                labelStyle={{ color: 'var(--muted)' }} itemStyle={{ color: pnlColor }}
                formatter={(v: any) => [`$${v}`, 'P&L']}
              />
              <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="3 3" />
              <Area type="monotone" dataKey="pnl" stroke={pnlColor} strokeWidth={1.5} fill="url(#pnlGrad)" dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      )}

      {/* ── Period P&L ── */}
      <Panel style={{ marginBottom: aurora ? 20 : 28 }} fadeClass="aurora-fade-6">
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <SectionTitle>P&amp;L Breakdown</SectionTitle>
          {(['daily', 'weekly', 'monthly'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPnlPeriod(p)}
              style={{
                padding: aurora ? '4px 10px' : '4px 12px',
                borderRadius: aurora ? 2 : '999px',
                border: aurora
                  ? `1px solid ${pnlPeriod === p ? 'var(--border-accent)' : 'var(--border)'}`
                  : '1px solid #374151',
                background: aurora
                  ? (pnlPeriod === p ? 'var(--accent-dim)' : 'transparent')
                  : (pnlPeriod === p ? '#3b82f6' : 'transparent'),
                color: aurora
                  ? (pnlPeriod === p ? 'var(--accent)' : 'var(--muted)')
                  : (pnlPeriod === p ? 'white' : 'inherit'),
                cursor: 'pointer',
                fontSize: aurora ? '0.65rem' : '13px',
                fontFamily: aurora ? 'var(--font-sans)' : 'inherit',
                fontWeight: aurora ? 600 : 400,
                letterSpacing: aurora ? '0.06em' : 0,
                textTransform: 'capitalize',
                transition: 'all 0.15s ease-out',
              }}
            >
              {p}
            </button>
          ))}
        </div>

        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={periodPnl.slice(-30)}>
            <XAxis dataKey="period" tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <YAxis tickFormatter={(v: number) => `$${v}`} tick={{ fontFamily: 'var(--font-mono)', fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
            <Tooltip
              contentStyle={{ background: 'var(--bg3)', border: '1px solid var(--border)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}
              formatter={(v: number) => [`$${Number(v).toFixed(2)}`, 'P&L']}
            />
            <Bar dataKey="total_pnl" radius={aurora ? [2, 2, 0, 0] : [3, 3, 0, 0]}>
              {periodPnl.slice(-30).map((_entry, i) => (
                <Cell key={i} fill={periodPnl.slice(-30)[i]?.total_pnl >= 0 ? 'var(--green)' : 'var(--danger)'} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        <table style={{ width: '100%', fontSize: aurora ? '11px' : '13px', borderCollapse: 'collapse', marginTop: '8px', fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}>
          <thead>
            <tr style={{ borderBottom: aurora ? '1px solid var(--border)' : '1px solid #374151' }}>
              {['Period', 'P&L', 'Trades', 'Win Rate', 'Avg Win', 'Avg Loss'].map(h => (
                <th key={h} style={{
                  textAlign: h === 'Period' ? 'left' : 'right',
                  padding: '4px 8px',
                  fontFamily: aurora ? 'var(--font-sans)' : 'inherit',
                  fontSize: 10,
                  fontWeight: 600,
                  color: 'var(--muted)',
                  letterSpacing: aurora ? '0.08em' : 0,
                  textTransform: 'uppercase',
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {[...periodPnl].reverse().slice(0, 10).map((row, i) => (
              <tr key={i} style={{ borderBottom: aurora ? '1px solid var(--border)' : '1px solid #1f2937' }}>
                <td style={{ padding: '4px 8px', color: 'var(--muted)' }}>{row.period}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: row.total_pnl >= 0 ? 'var(--green)' : 'var(--danger)', fontWeight: 700 }}>
                  ${row.total_pnl.toFixed(2)}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text)' }}>{row.trade_count}</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--text)' }}>{row.win_rate}%</td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--green)' }}>
                  {row.avg_win != null ? `$${row.avg_win.toFixed(2)}` : '—'}
                </td>
                <td style={{ padding: '4px 8px', textAlign: 'right', color: 'var(--danger)' }}>
                  {row.avg_loss != null ? `$${row.avg_loss.toFixed(2)}` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {/* ── Agent logs + Live logs + Failed trades ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px,1fr))', gap: aurora ? 20 : 12, marginBottom: aurora ? 20 : 28 }}>
        <LogsPanel />

        {/* Live logs panel */}
        <div
          className={aurora ? 'aurora-card aurora-fade-7' : undefined}
          style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}
        >
          <div
            onClick={() => setLogsOpen(o => !o)}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: aurora ? '0 0 12px 0' : '12px 20px',
              borderBottom: logsOpen ? '1px solid var(--border)' : 'none',
              cursor: 'pointer', userSelect: 'none',
            }}
          >
            <span className={aurora ? 'aurora-section-title' : undefined} style={{
              fontFamily: aurora ? undefined : 'var(--font-mono)',
              fontSize: aurora ? undefined : 11,
              color: aurora ? undefined : 'var(--muted)',
              letterSpacing: aurora ? undefined : '0.08em',
              flex: 1,
              marginBottom: aurora ? 0 : undefined,
            }}>
              Live Logs
            </span>
            {wsStatus === 'live' && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)' }}>
                <span className={aurora ? 'aurora-live-dot' : undefined} style={!aurora ? { width: 7, height: 7, borderRadius: '50%', background: 'var(--green)', display: 'inline-block', animation: 'pulse 2s ease infinite' } : undefined} />
                {aurora ? 'LIVE' : 'LIVE'}
              </span>
            )}
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{logsOpen ? '▲' : '▼'}</span>
          </div>
          {logsOpen && (
            <div style={{
              height: 280,
              overflowY: 'auto',
              padding: aurora ? '8px 0' : '8px 16px',
              background: aurora ? 'transparent' : 'var(--bg3)',
            }}>
              {liveLogs.length === 0 ? (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>No logs yet...</span>
              ) : (
                liveLogs.map((log, i) => {
                  const opacity = aurora
                    ? (() => {
                        const pos = liveLogs.length - 1 - i
                        if (pos === 0) return 1
                        if (pos === 1) return 0.85
                        if (pos === 2) return 0.65
                        if (pos === 3) return 0.5
                        if (pos === 4) return 0.35
                        return 0.22
                      })()
                    : 1
                  return (
                    <div
                      key={i}
                      className={aurora ? 'aurora-log-line' : undefined}
                      style={{
                        display: aurora ? undefined : 'flex',
                        gap: aurora ? undefined : 10,
                        marginBottom: aurora ? undefined : 2,
                        fontSize: 10,
                        fontFamily: 'var(--font-mono)',
                        lineHeight: aurora ? undefined : 1.5,
                        opacity,
                        color: aurora ? (i === liveLogs.length - 1 ? 'var(--text)' : 'var(--muted)') : undefined,
                      }}
                    >
                      <span style={{ color: 'var(--muted)', flexShrink: 0 }}>
                        {new Date(log.ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                      </span>
                      {' '}
                      <span style={{
                        flexShrink: 0,
                        minWidth: aurora ? undefined : 36,
                        textTransform: 'uppercase',
                        fontSize: 9,
                        letterSpacing: '0.06em',
                        color: log.level === 'error' ? 'var(--danger)' : log.level === 'warn' ? 'var(--warn)' : aurora ? 'var(--accent)' : 'var(--muted)',
                      }}>
                        [{log.level}]
                      </span>
                      {' '}
                      <span style={{ color: log.level === 'error' ? 'var(--danger)' : log.level === 'warn' ? 'var(--warn)' : 'var(--text)', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        {log.msg}
                      </span>
                    </div>
                  )
                })
              )}
            </div>
          )}
        </div>

        {/* Failed trades */}
        <div
          className={aurora ? 'aurora-card aurora-fade-7' : undefined}
          style={{
            background: 'var(--bg2)',
            border: '1px solid var(--border)',
            overflow: 'hidden',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', padding: aurora ? '0 0 12px 0' : '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <span style={{
              fontFamily: aurora ? 'var(--font-sans)' : 'var(--font-mono)',
              fontSize: aurora ? '0.65rem' : 11,
              fontWeight: aurora ? 600 : 400,
              color: 'var(--danger)',
              letterSpacing: aurora ? '0.13em' : '0.08em',
              textTransform: 'uppercase',
              flex: 1,
            }}>
              Failed Trades ({failedTrades.length})
            </span>
          </div>
          <div style={{ height: 280, overflowY: 'auto', padding: aurora ? '8px 0' : '8px 12px' }}>
            {failedTrades.length === 0 ? (
              <div style={{ padding: '40px 8px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
                No failed trades
              </div>
            ) : (
              failedTrades.map(t => (
                <div key={t._id} style={{ padding: '8px 6px', borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', whiteSpace: 'nowrap' }}>{fmt(t.timestamp)}</span>
                    <ActionBadge action={t.decision.action} />
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{t.decision.asset}</span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>${t.decision.amount_usd.toLocaleString()}</span>
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)', marginBottom: 4 }}>
                    Strategy: {inferStrategyLabel(t)}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--danger)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                    {t.execution_error}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* ── Fine-tuning pipeline ── */}
      <div style={{ marginBottom: aurora ? 20 : 28 }}>
        <TrainingPanel />
      </div>

      {/* ── Decision log ── */}
      <Panel style={{ overflow: 'hidden', padding: 0 }} fadeClass="aurora-fade-7">
        <div style={{
          padding: aurora ? '14px 22px' : '14px 20px',
          borderBottom: '1px solid var(--border)',
          fontFamily: aurora ? 'var(--font-sans)' : 'var(--font-mono)',
          fontSize: aurora ? '0.65rem' : 11,
          fontWeight: aurora ? 600 : 400,
          color: 'var(--muted)',
          letterSpacing: aurora ? '0.13em' : '0.08em',
          textTransform: 'uppercase',
        }}>
          Decision Log ({trades.length}) — click row to replay
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table
            className={aurora ? 'aurora-table' : undefined}
            style={{ width: '100%', borderCollapse: 'collapse' }}
          >
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Time', 'Action', 'Asset', 'Strategy', 'Amount', 'Price', 'RSI', 'Confidence', 'SL / TP', 'Net P&L', 'Status'].map(h => (
                  <th key={h} style={{
                    padding: aurora ? '0 12px 10px 0' : '10px 16px',
                    textAlign: 'left',
                    fontFamily: aurora ? 'var(--font-sans)' : 'var(--font-mono)',
                    fontSize: 10,
                    color: 'var(--muted)',
                    letterSpacing: aurora ? '0.11em' : '0.08em',
                    fontWeight: aurora ? 600 : 400,
                    whiteSpace: 'nowrap',
                    textTransform: 'uppercase',
                    borderBottom: aurora ? '1px solid var(--border)' : undefined,
                  }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {trades.map((t, i) => {
                const snap = t.market[t.decision.asset]
                const grossPnl = t.outcome?.pnl_usd
                const netPnl = t.net_pnl_usd !== undefined ? t.net_pnl_usd : grossPnl
                const hasBreakdown = t.net_pnl_usd !== undefined && grossPnl !== undefined
                const strategyLabel = inferStrategyLabel(t)
                const pnlTitle = hasBreakdown
                  ? `Gross: ${grossPnl! >= 0 ? '+' : ''}$${grossPnl!.toFixed(2)}  |  Fees: $${(t.fees_usd ?? 0).toFixed(2)}  |  Tax: $${(t.tax_usd ?? 0).toFixed(2)}`
                  : undefined
                return (
                  <tr
                    key={t._id}
                    onClick={() => setReplayTrade(t)}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      background: aurora ? 'transparent' : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)'),
                      cursor: 'pointer',
                      transition: 'background 0.15s ease-out',
                    }}
                    onMouseEnter={e => {
                      (e.currentTarget as HTMLTableRowElement).style.background = aurora
                        ? 'rgba(200,255,0,0.03)'
                        : 'rgba(255,255,255,0.04)'
                    }}
                    onMouseLeave={e => {
                      (e.currentTarget as HTMLTableRowElement).style.background = aurora
                        ? 'transparent'
                        : (i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')
                    }}
                  >
                    <td style={{ padding: aurora ? '10px 12px 10px 0' : '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmt(t.timestamp)}</td>
                    <td style={{ padding: aurora ? '10px 12px 10px 0' : '10px 16px' }}><ActionBadge action={t.decision.action} /></td>
                    <td style={{ padding: aurora ? '10px 12px 10px 0' : '10px 16px', fontFamily: 'var(--font-mono)', fontSize: aurora ? '0.85rem' : 12, fontWeight: 700, color: 'var(--text)' }}>{t.decision.asset}</td>
                    <td style={{ padding: aurora ? '10px 12px 10px 0' : '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: strategyLabel === '—' ? 'var(--muted)' : 'var(--muted)', whiteSpace: 'nowrap' }}>{strategyLabel}</td>
                    <td style={{ padding: aurora ? '10px 12px 10px 0' : '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', fontVariantNumeric: 'tabular-nums' }}>${t.decision.amount_usd.toLocaleString()}</td>
                    <td style={{ padding: aurora ? '10px 12px 10px 0' : '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{snap ? `$${snap.price.toLocaleString()}` : '—'}</td>
                    <td style={{ padding: aurora ? '10px 12px 10px 0' : '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, color: snap?.rsi_14 !== undefined ? (snap.rsi_14 > 70 ? 'var(--danger)' : snap.rsi_14 < 30 ? 'var(--green)' : 'var(--text)') : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>
                      {snap?.rsi_14 ?? '—'}
                    </td>
                    <td style={{ padding: aurora ? '10px 12px 10px 0' : '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 12, fontVariantNumeric: 'tabular-nums' }}>{(t.decision.confidence * 100).toFixed(0)}%</td>
                    <td style={{ padding: aurora ? '10px 12px 10px 0' : '10px 16px', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      {t.sl_price ? (
                        <span>
                          <span style={{ color: 'var(--danger)' }}>${t.sl_price.toLocaleString()}</span>
                          {t.tp_price && <span> / <span style={{ color: 'var(--green)' }}>${t.tp_price.toLocaleString()}</span></span>}
                        </span>
                      ) : '—'}
                    </td>
                    <td
                      title={pnlTitle}
                      style={{ padding: aurora ? '10px 0 10px 0' : '10px 16px', whiteSpace: 'nowrap', cursor: pnlTitle ? 'help' : undefined, textAlign: aurora ? 'right' : 'left' }}
                    >
                      {netPnl !== undefined ? (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: netPnl >= 0 ? 'var(--green)' : 'var(--danger)', fontVariantNumeric: 'tabular-nums' }}>
                          {netPnl >= 0 ? '+' : ''}${netPnl.toFixed(2)}
                        </span>
                      ) : (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>—</span>
                      )}
                      {hasBreakdown && grossPnl !== undefined && grossPnl !== netPnl && (
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginLeft: 4, fontVariantNumeric: 'tabular-nums' }}>
                          ({grossPnl >= 0 ? '+' : ''}${grossPnl.toFixed(2)})
                        </span>
                      )}
                    </td>
                    <td
                      title={t.execution_error || undefined}
                      style={{
                        padding: aurora ? '10px 0 10px 0' : '10px 16px',
                        fontFamily: 'var(--font-mono)',
                        fontSize: 10,
                        textAlign: aurora ? 'right' : 'left',
                        color: t.executed ? 'var(--green)' : t.execution_error ? 'var(--danger)' : t.approved && (t.approval_mode ?? 'manual') === 'auto' ? 'var(--accent)' : t.approved ? 'var(--muted)' : t.decision.action === 'hold' ? 'var(--muted)' : 'var(--warn)',
                      }}
                    >
                      {t.executed ? 'EXECUTED' : t.execution_error ? (
                        <>
                          FAILED
                          <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {t.execution_error.slice(0, 80)}
                          </div>
                        </>
                      ) : t.approved && (t.approval_mode ?? 'manual') === 'auto' ? 'AUTO' : t.approved ? 'REJECTED' : t.decision.action === 'hold' ? 'HOLD' : 'PENDING'}
                    </td>
                  </tr>
                )
              })}
              {trades.length === 0 && (
                <tr><td colSpan={11} style={{ padding: '40px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
                  Waiting for first agent cycle...
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* ── Trade Replay Modal ── */}
      {replayTrade && (
        <TradeReplayModal trade={replayTrade} onClose={() => setReplayTrade(null)} />
      )}
    </div>
  )
}
