import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'
import type { AlpacaAsset } from '../api'

export function Assets() {
  const [available, setAvailable]   = useState<AlpacaAsset[]>([])
  const [active, setActive]         = useState<Set<string>>(new Set())
  const [pending, setPending]       = useState<Set<string>>(new Set())
  const [search, setSearch]         = useState('')
  const [loadingFetch, setLoadingFetch] = useState(true)
  const [saving, setSaving]         = useState(false)
  const [error, setError]           = useState<string | null>(null)
  const [saveMsg, setSaveMsg]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadingFetch(true)
    setError(null)
    try {
      const [avail, act] = await Promise.all([api.availableAssets(), api.activeAssets()])
      setAvailable(avail)
      setActive(new Set(act))
      setPending(new Set(act))
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoadingFetch(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const toggle = (symbol: string) => {
    setPending(prev => {
      const next = new Set(prev)
      if (next.has(symbol)) next.delete(symbol)
      else next.add(symbol)
      return next
    })
  }

  const save = async () => {
    setSaving(true)
    setSaveMsg(null)
    try {
      await api.setActiveAssets([...pending])
      setActive(new Set(pending))
      setSaveMsg(`Saved ${pending.size} active asset${pending.size !== 1 ? 's' : ''}. Changes apply on next agent cycle.`)
      setTimeout(() => setSaveMsg(null), 4000)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const isDirty = [...pending].sort().join() !== [...active].sort().join()

  const filtered = available.filter(a =>
    a.symbol.toLowerCase().includes(search.toLowerCase()) ||
    a.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div style={{ padding: '28px', maxWidth: 900, margin: '0 auto' }}>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--accent)', marginBottom: 6 }}>
          TRADEABLE ASSETS
        </h2>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
          Toggle assets on/off. The agent will only poll and trade enabled assets.
        </p>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 20, alignItems: 'center' }}>
        <input
          type="text"
          placeholder="Search symbol or name..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            flex: 1, padding: '8px 14px',
            background: 'var(--bg2)', border: '1px solid var(--border2)',
            borderRadius: 6, color: 'var(--text)',
            fontFamily: 'var(--font-mono)', fontSize: 12,
            outline: 'none',
          }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
          {pending.size} active
        </span>
        {isDirty && (
          <button
            onClick={save}
            disabled={saving}
            style={{
              padding: '8px 20px', borderRadius: 6,
              background: 'var(--accent)', color: '#000',
              fontFamily: 'var(--font-mono)', fontSize: 11,
              fontWeight: 700, letterSpacing: '0.06em',
              border: 'none', whiteSpace: 'nowrap',
            }}
          >
            {saving ? 'SAVING…' : '✓ APPLY'}
          </button>
        )}
      </div>

      {/* Status messages */}
      {saveMsg && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: 'rgba(0,212,170,0.08)', border: '1px solid rgba(0,212,170,0.25)',
          borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)',
        }}>
          ✓ {saveMsg}
        </div>
      )}
      {error && (
        <div style={{
          marginBottom: 16, padding: '10px 14px',
          background: 'rgba(255,77,109,0.08)', border: '1px solid rgba(255,77,109,0.25)',
          borderRadius: 6, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)',
        }}>
          ✕ {error}
        </div>
      )}

      {/* Loading */}
      {loadingFetch ? (
        <div style={{ textAlign: 'center', padding: '60px 0', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)', animation: 'pulse 1.2s ease infinite' }}>
          Fetching assets from Alpaca…
        </div>
      ) : (
        <>
          {/* Active assets summary */}
          {active.size > 0 && (
            <div style={{ marginBottom: 20, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {[...active].sort().map(sym => (
                <span key={sym} style={{
                  padding: '3px 10px', borderRadius: 4,
                  background: 'rgba(0,212,170,0.1)', border: '1px solid rgba(0,212,170,0.25)',
                  fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--accent)',
                  letterSpacing: '0.05em',
                }}>
                  {sym}
                </span>
              ))}
            </div>
          )}

          {/* Asset grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 8 }}>
            {filtered.map(asset => {
              const isOn = pending.has(asset.symbol)
              return (
                <div
                  key={asset.symbol}
                  onClick={() => toggle(asset.symbol)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '12px 14px', borderRadius: 8,
                    background: isOn ? 'rgba(0,212,170,0.06)' : 'var(--bg2)',
                    border: `1px solid ${isOn ? 'rgba(0,212,170,0.22)' : 'var(--border)'}`,
                    cursor: 'pointer', transition: 'all 0.15s',
                    userSelect: 'none',
                  }}
                >
                  {/* Toggle pill */}
                  <div style={{
                    width: 36, height: 20, borderRadius: 10, flexShrink: 0, position: 'relative',
                    background: isOn ? 'var(--accent)' : 'var(--bg3)',
                    border: `1px solid ${isOn ? 'var(--accent)' : 'var(--border2)'}`,
                    transition: 'background 0.15s',
                  }}>
                    <span style={{
                      position: 'absolute', top: 2,
                      left: isOn ? 18 : 2,
                      width: 14, height: 14, borderRadius: '50%',
                      background: isOn ? '#000' : 'var(--muted)',
                      transition: 'left 0.15s',
                    }} />
                  </div>

                  {/* Info */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: isOn ? 'var(--text)' : 'var(--muted)' }}>
                      {asset.symbol}
                    </div>
                    <div style={{ fontFamily: 'var(--font-sans)', fontSize: 11, color: 'var(--muted)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {asset.name}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {filtered.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 0', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
              No assets match "{search}"
            </div>
          )}
        </>
      )}
    </div>
  )
}
