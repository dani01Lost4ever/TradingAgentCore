import { useState } from 'react'
import { api } from '../api'
import type { Trade } from '../api'
import { ActionBadge } from './ActionBadge'

interface Props {
  trade: Trade
  onDone: () => void
}

export function PendingCard({ trade, onDone }: Props) {
  const [loading, setLoading] = useState<'approve' | 'reject' | null>(null)
  const d = trade.decision
  const snap = trade.market[d.asset]

  async function handle(type: 'approve' | 'reject') {
    setLoading(type)
    try {
      type === 'approve' ? await api.approve(trade._id) : await api.reject(trade._id)
      onDone()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(null)
    }
  }

  return (
    <div style={{
      background: 'var(--bg2)', border: '1px solid var(--warn)',
      borderRadius: 8, padding: 20,
      boxShadow: '0 0 20px rgba(245,158,11,0.06)',
      animation: 'fadeUp 0.25s ease both',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <ActionBadge action={d.action} />
        <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 15 }}>{d.asset}</span>
        <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent)', marginLeft: 'auto', fontSize: 15 }}>
          ${d.amount_usd.toLocaleString()}
        </span>
      </div>

      {snap && (
        <div style={{ display: 'flex', gap: 20, marginBottom: 12, fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
          <span>Price <b style={{ color: 'var(--text)' }}>${snap.price.toLocaleString()}</b></span>
          <span>24h <b style={{ color: snap.change_24h >= 0 ? 'var(--green)' : 'var(--danger)' }}>{snap.change_24h > 0 ? '+' : ''}{snap.change_24h}%</b></span>
          {snap.rsi_14 !== undefined && <span>RSI <b style={{ color: 'var(--text)' }}>{snap.rsi_14}</b></span>}
          <span>Confidence <b style={{ color: 'var(--text)' }}>{(d.confidence * 100).toFixed(0)}%</b></span>
        </div>
      )}

      <p style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5, marginBottom: 16, borderLeft: '2px solid var(--border2)', paddingLeft: 10 }}>
        {d.reasoning}
      </p>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          onClick={() => handle('approve')}
          disabled={!!loading}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 5,
            background: loading === 'approve' ? 'var(--border2)' : 'rgba(34,197,94,0.15)',
            color: 'var(--green)', border: '1px solid rgba(34,197,94,0.3)',
            fontWeight: 600, letterSpacing: '0.05em',
            transition: 'all 0.15s',
          }}
        >
          {loading === 'approve' ? 'EXECUTING...' : '✓ APPROVE & EXECUTE'}
        </button>
        <button
          onClick={() => handle('reject')}
          disabled={!!loading}
          style={{
            flex: 1, padding: '9px 0', borderRadius: 5,
            background: loading === 'reject' ? 'var(--border2)' : 'rgba(255,77,109,0.1)',
            color: 'var(--danger)', border: '1px solid rgba(255,77,109,0.2)',
            fontWeight: 600, letterSpacing: '0.05em',
            transition: 'all 0.15s',
          }}
        >
          {loading === 'reject' ? '...' : '✕ REJECT'}
        </button>
      </div>
    </div>
  )
}
