import { useState, useEffect } from 'react'
import { api } from '../api'
import type { AuditEvent } from '../api'

const card: React.CSSProperties = {
  background: 'var(--bg2)', border: '1px solid var(--border)',
  padding: '0',
}

const ACTION_COLORS: Record<string, string> = {
  login:           'var(--green)',
  'config.update': 'var(--accent)',
  'risk.update':   'var(--accent)',
  'keys.update':   '#f59e0b',
  'trade.approve': 'var(--green)',
  'trade.reject':  'var(--danger)',
  'password.change': '#f59e0b',
  'prompt.update': 'var(--accent)',
  'prompt.delete': 'var(--danger)',
}

function actionColor(action: string): string {
  for (const [prefix, color] of Object.entries(ACTION_COLORS)) {
    if (action.startsWith(prefix)) return color
  }
  return 'var(--muted)'
}

export function AuditLog() {
  const [events, setEvents] = useState<AuditEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [limit, setLimit] = useState(100)
  const [search, setSearch] = useState('')

  async function load() {
    setLoading(true)
    try {
      const res = await api.audit(limit)
      setEvents(res.events)
    } catch { /* ignore */ } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [limit])

  useEffect(() => {
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [limit])

  const filtered = search
    ? events.filter(e =>
        e.action.includes(search) ||
        e.user.includes(search) ||
        e.details?.includes(search)
      )
    : events

  return (
    <div style={{ padding: '32px 40px', maxWidth: 1200, margin: '0 auto' }}>
      <h2 style={{ margin: '0 0 28px', fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent)' }}>
        AUDIT LOG
      </h2>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input
          style={{
            padding: '7px 12px', background: 'var(--bg3)',
            border: '1px solid var(--border2)', borderRadius: 0,
            color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
            width: 240, outline: 'none',
          }}
          placeholder="Search action / user / details…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          style={{
            padding: '7px 12px', background: 'var(--bg3)',
            border: '1px solid var(--border2)', borderRadius: 0,
            color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
            outline: 'none',
          }}
          value={limit}
          onChange={e => setLimit(Number(e.target.value))}
        >
          <option value={50}>Last 50</option>
          <option value={100}>Last 100</option>
          <option value={250}>Last 250</option>
          <option value={500}>Last 500</option>
        </select>
        <button
          onClick={load}
          style={{
            padding: '7px 16px', borderRadius: 0, fontSize: 11,
            fontFamily: 'var(--font-mono)', border: '1px solid var(--border2)',
            background: 'transparent', color: 'var(--text)', cursor: 'pointer',
          }}
        >
          ↻ Refresh
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
          {filtered.length} events · auto-refreshes every 30s
        </span>
      </div>

      <div style={card}>
        {loading && events.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 16 }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div style={{ color: 'var(--muted)', fontSize: 12, fontFamily: 'var(--font-mono)', padding: 16 }}>No events found.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="aurora-table" style={{ padding: '0 4px' }}>
              <thead>
                <tr>
                  {['Timestamp', 'User', 'Action', 'Details', 'IP'].map(h => (
                    <th key={h} style={{ whiteSpace: 'nowrap', textAlign: 'left' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e._id}>
                    <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {new Date(e.ts).toLocaleString()}
                    </td>
                    <td>{e.user}</td>
                    <td>
                      <span style={{
                        color: actionColor(e.action),
                        background: `${actionColor(e.action)}18`,
                        padding: '2px 8px',
                        fontWeight: 600, letterSpacing: '0.04em', fontSize: 10,
                      }}>
                        {e.action}
                      </span>
                    </td>
                    <td style={{ color: 'var(--muted)', maxWidth: 400, wordBreak: 'break-word', whiteSpace: 'normal', fontFamily: 'var(--font-sans)', fontSize: '0.72rem' }}>
                      {e.details || '—'}
                    </td>
                    <td style={{ color: 'var(--muted)' }}>
                      {e.ip || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
