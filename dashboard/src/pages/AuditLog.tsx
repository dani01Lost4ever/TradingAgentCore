import { useState, useEffect } from 'react'
import { api } from '../api'
import type { AuditEvent } from '../api'

const card: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '20px 24px',
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
      <h2 style={{ margin: '0 0 28px', fontFamily: 'var(--font-mono)', fontSize: 16, letterSpacing: '0.08em', color: 'var(--text)' }}>
        AUDIT LOG
      </h2>

      <div style={{ display: 'flex', gap: 12, marginBottom: 16, alignItems: 'center' }}>
        <input
          style={{
            padding: '7px 12px', background: 'var(--input-bg)',
            border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
            width: 240,
          }}
          placeholder="Search action / user / details…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          style={{
            padding: '7px 12px', background: 'var(--input-bg)',
            border: '1px solid var(--border)', borderRadius: 6,
            color: 'var(--text)', fontSize: 12, fontFamily: 'var(--font-mono)',
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
            padding: '7px 16px', borderRadius: 6, fontSize: 11,
            fontFamily: 'var(--font-mono)', border: '1px solid var(--border)',
            background: 'var(--card)', color: 'var(--text)', cursor: 'pointer',
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
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
              <thead>
                <tr style={{ color: 'var(--muted)' }}>
                  {['Timestamp', 'User', 'Action', 'Details', 'IP'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 12px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr key={e._id} style={{ borderBottom: '1px solid var(--border2)' }}>
                    <td style={{ padding: '7px 12px', whiteSpace: 'nowrap', color: 'var(--muted)' }}>
                      {new Date(e.ts).toLocaleString()}
                    </td>
                    <td style={{ padding: '7px 12px', color: 'var(--text)' }}>{e.user}</td>
                    <td style={{ padding: '7px 12px' }}>
                      <span style={{
                        color: actionColor(e.action),
                        background: `${actionColor(e.action)}18`,
                        padding: '2px 8px', borderRadius: 4,
                        fontWeight: 600, letterSpacing: '0.04em',
                      }}>
                        {e.action}
                      </span>
                    </td>
                    <td style={{ padding: '7px 12px', color: 'var(--muted)', maxWidth: 400, wordBreak: 'break-word' }}>
                      {e.details || '—'}
                    </td>
                    <td style={{ padding: '7px 12px', color: 'var(--muted)' }}>
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
