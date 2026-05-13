import { useEffect, useRef, useState, useCallback } from 'react'
import { api } from '../api'
import type { LogEntry } from '../api'

const LEVEL_COLOR: Record<LogEntry['level'], string> = {
  info:  'var(--text)',
  warn:  'var(--warn)',
  error: 'var(--danger)',
}

const LEVEL_PREFIX: Record<LogEntry['level'], string> = {
  info:  'OK',
  warn:  'WRN',
  error: 'ERR',
}

// Aurora-dark: older rows fade out progressively
function getAuroraOpacity(index: number, total: number): number {
  const pos = total - 1 - index // 0 = newest
  if (pos === 0) return 1
  if (pos === 1) return 0.85
  if (pos === 2) return 0.65
  if (pos === 3) return 0.50
  if (pos === 4) return 0.35
  return 0.22
}

function fmtTime(ts: string) {
  return new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function isAuroraDark(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'aurora-dark'
}

export function LogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [paused, setPaused] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const fetch = useCallback(async () => {
    if (pausedRef.current) return
    try {
      const data = await api.logs()
      setLogs(data)
    } catch { /* agent might be starting up */ }
  }, [])

  useEffect(() => { fetch() }, [fetch])
  useEffect(() => {
    const id = setInterval(fetch, 3000)
    return () => clearInterval(id)
  }, [fetch])

  // Auto-scroll to bottom unless paused
  useEffect(() => {
    if (!paused && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [logs, paused])

  const aurora = isAuroraDark()

  if (aurora) {
    return (
      <div className="aurora-card" style={{ overflow: 'hidden' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
          <span className="aurora-section-title" style={{ flex: 1, marginBottom: 0 }}>
            Agent Logs
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', fontWeight: 400, letterSpacing: '0.04em', textTransform: 'none', marginLeft: 6 }}>
              ({logs.length})
            </span>
          </span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', marginRight: 8 }}>
            {paused ? 'PAUSED' : 'LIVE · 3s'}
          </span>
          <button
            onClick={() => setPaused(p => !p)}
            style={{
              padding: '3px 10px',
              fontSize: '0.65rem',
              fontFamily: 'var(--font-sans)',
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              background: paused ? 'var(--accent-dim)' : 'transparent',
              color: paused ? 'var(--accent)' : 'var(--muted)',
              border: '1px solid var(--border)',
              cursor: 'pointer',
              transition: 'all 0.15s ease-out',
            }}
          >
            {paused ? 'Resume' : 'Pause'}
          </button>
        </div>

        {/* Log list */}
        <div ref={scrollRef} className="aurora-log-lines" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {logs.length === 0 ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.65rem', color: 'var(--muted)', padding: '20px 0' }}>
              Waiting for agent...
            </div>
          ) : (
            logs.map((entry, i) => {
              const opacity = getAuroraOpacity(i, logs.length)
              const tsColor = 'var(--muted)'
              const levelColor = entry.level === 'error' ? 'var(--danger)' : entry.level === 'warn' ? 'var(--warn)' : 'var(--accent)'
              return (
                <div
                  key={i}
                  className="aurora-log-line"
                  style={{ opacity, color: i === logs.length - 1 ? 'var(--text)' : 'var(--txt-secondary, var(--muted))' }}
                >
                  <span style={{ color: tsColor }}>{fmtTime(entry.ts)}</span>
                  {' '}
                  <span style={{ color: levelColor }}>{LEVEL_PREFIX[entry.level]}</span>
                  {' '}
                  {entry.msg}
                </div>
              )
            })
          )}
        </div>
      </div>
    )
  }

  // Legacy (non-aurora) rendering
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', flex: 1 }}>
          AGENT LOGS ({logs.length})
        </span>
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginRight: 8 }}>
          {paused ? 'PAUSED' : 'LIVE · 3s'}
        </span>
        <button
          onClick={() => setPaused(p => !p)}
          style={{
            padding: '3px 10px', fontSize: 11,
            background: paused ? 'rgba(0,212,170,0.1)' : 'rgba(255,255,255,0.05)',
            color: paused ? 'var(--accent)' : 'var(--muted)',
            border: '1px solid var(--border2)',
          }}
        >
          {paused ? 'RESUME' : 'PAUSE'}
        </button>
      </div>

      {/* Log list */}
      <div ref={scrollRef} style={{ height: 280, overflowY: 'auto', padding: '8px 0' }}>
        {logs.length === 0 ? (
          <div style={{ padding: '40px 16px', textAlign: 'center', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
            Waiting for agent...
          </div>
        ) : (
          logs.map((entry, i) => (
            <div
              key={i}
              style={{
                display: 'flex', gap: 10, padding: '2px 16px',
                fontFamily: 'var(--font-mono)', fontSize: 11, lineHeight: 1.6,
                background: entry.level === 'error' ? 'rgba(255,77,109,0.05)' : 'transparent',
              }}
            >
              <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap', flexShrink: 0 }}>
                {fmtTime(entry.ts)}
              </span>
              <span style={{ color: LEVEL_COLOR[entry.level], flexShrink: 0 }}>
                {entry.level === 'info' ? '·' : entry.level === 'warn' ? '▲' : '✕'}
              </span>
              <span style={{ color: LEVEL_COLOR[entry.level], wordBreak: 'break-word' }}>
                {entry.msg}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
