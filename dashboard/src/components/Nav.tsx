import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Page } from '../App'
import { api } from '../api'
import type { AuthUser, LivePrices } from '../api'

const NAV_ITEMS: { id: Page; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'charts', label: 'Charts' },
  { id: 'assets', label: 'Assets' },
  { id: 'tokens', label: 'Cost' },
  { id: 'settings', label: 'Settings' },
  { id: 'strategies', label: 'Strategies' },
  { id: 'backtest', label: 'Backtest' },
  { id: 'discovery', label: 'Discovery' },
  { id: 'reasoning', label: 'Reasoning' },
  { id: 'auditlog', label: 'Audit' },
  { id: 'wiki', label: 'Wiki' },
]

interface NavProps {
  current: Page
  onNavigate: (page: Page) => void
  onLogout: () => void
  me: AuthUser | null
}

function isAuroraDark(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'aurora-dark'
}

function PriceTicker() {
  const [prices, setPrices] = useState<LivePrices>({})

  useEffect(() => {
    const fetchPrices = () => api.livePrices().then(setPrices).catch(() => {})
    fetchPrices()
    const id = setInterval(fetchPrices, 30_000)
    return () => clearInterval(id)
  }, [])

  const assets = Object.keys(prices)
  if (!assets.length) return null

  return (
    <div style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', flexShrink: 1, minWidth: 0 }}>
      {assets.map((asset, i) => {
        const { price, change24h } = prices[asset]
        const up = change24h >= 0
        const fmt = price >= 1000
          ? price.toLocaleString(undefined, { maximumFractionDigits: 0 })
          : price >= 1 ? price.toFixed(3) : price.toFixed(6)
        return (
          <span key={asset} style={{ display: 'flex', alignItems: 'center' }}>
            {i > 0 && <span style={{ color: 'var(--border2)', margin: '0 8px', fontFamily: 'var(--font-mono)', fontSize: 10 }}>|</span>}
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--muted)',
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
            }}>
              <span style={{ color: 'var(--text)' }}>{asset.replace('/USD', '')}</span>{' '}
              <span style={{ color: 'var(--text)' }}>${fmt}</span>{' '}
              <span style={{ color: up ? 'var(--green)' : 'var(--danger)' }}>{up ? '+' : ''}{change24h.toFixed(2)}%</span>
            </span>
          </span>
        )
      })}
    </div>
  )
}

export function Nav({ current, onNavigate, onLogout, me }: NavProps) {
  const items = me?.role === 'admin'
    ? [...NAV_ITEMS, { id: 'admin' as Page, label: 'Engines' }]
    : NAV_ITEMS
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const aurora = isAuroraDark()

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!menuRef.current) return
      if (!menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [])

  if (aurora) {
    return (
      <nav style={{
        position: 'sticky',
        top: 0,
        zIndex: 100,
        background: 'var(--nav-bg)',
        borderBottom: '1px solid var(--nav-border)',
        display: 'flex',
        alignItems: 'center',
        padding: '0 24px',
        height: 58,
        gap: 4,
      }}>
        {/* Brand wordmark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 24, flexShrink: 0 }}>
          <span className="aurora-brand">aurora</span>
          <span className="aurora-live-dot" />
        </div>

        {/* Nav links */}
        {items.map((item) => {
          const active = current === item.id
          return (
            <button
              key={item.id}
              onClick={() => onNavigate(item.id)}
              style={{
                position: 'relative',
                padding: '6px 10px',
                fontSize: '0.72rem',
                fontFamily: 'var(--font-sans)',
                fontWeight: active ? 600 : 400,
                letterSpacing: '0.04em',
                background: 'transparent',
                color: active ? 'var(--text)' : 'var(--muted)',
                border: 'none',
                cursor: 'pointer',
                transition: 'color 0.15s ease-out',
                flexShrink: 0,
              }}
              className={`aurora-nav-link${active ? ' active' : ''}`}
              onMouseEnter={(e) => {
                if (!active) e.currentTarget.style.color = 'var(--text)'
              }}
              onMouseLeave={(e) => {
                if (!active) e.currentTarget.style.color = 'var(--muted)'
              }}
            >
              {item.label}
            </button>
          )
        })}

        {/* Price ticker */}
        <div style={{ marginLeft: 16, flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
          <PriceTicker />
        </div>

        {/* Account dropdown */}
        <div ref={menuRef} style={{ marginLeft: 8, position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => setMenuOpen((v) => !v)}
            style={{
              padding: '5px 12px',
              fontSize: '0.72rem',
              fontFamily: 'var(--font-sans)',
              fontWeight: 500,
              letterSpacing: '0.04em',
              background: menuOpen ? 'var(--accent-dim)' : 'transparent',
              color: menuOpen ? 'var(--accent)' : 'var(--muted)',
              border: '1px solid ' + (menuOpen ? 'var(--border-accent)' : 'var(--border)'),
              cursor: 'pointer',
              transition: 'all 0.15s ease-out',
            }}
          >
            {me?.username || 'Account'} ▾
          </button>
          {menuOpen && (
            <div style={{
              position: 'absolute',
              right: 0,
              top: 36,
              minWidth: 150,
              background: 'var(--bg2)',
              border: '1px solid var(--border)',
              padding: 6,
              zIndex: 200,
            }}>
              <button onClick={() => { onNavigate('profile'); setMenuOpen(false) }} style={auroraMenuItemStyle}>
                Profile
              </button>
              <button
                onClick={() => {
                  setMenuOpen(false)
                  if (window.confirm('Confirm logout?')) onLogout()
                }}
                style={{ ...auroraMenuItemStyle, color: 'var(--danger)' }}
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </nav>
    )
  }

  // Legacy (non-aurora) nav
  return (
    <nav style={{
      position: 'sticky',
      top: 0,
      zIndex: 100,
      background: 'var(--nav-bg)',
      borderBottom: '1px solid var(--nav-border)',
      backdropFilter: 'blur(8px)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 24px',
      height: 58,
      gap: 4,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 28, flexShrink: 0 }}>
        <span style={{ fontSize: 11, color: 'var(--accent)', border: '1px solid currentColor', padding: '2px 4px', fontFamily: 'var(--font-mono)' }}>AI</span>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 700, color: 'var(--text)', letterSpacing: '0.06em' }}>
          AURORA<span style={{ color: 'var(--accent)' }}>TRADER</span>
        </span>
      </div>

      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          style={{
            padding: '6px 14px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.06em',
            display: 'flex',
            alignItems: 'center',
            gap: 0,
            background: current === item.id ? 'rgba(var(--accent-rgb, 61,210,255), 0.14)' : 'transparent',
            color: current === item.id ? 'var(--accent)' : 'var(--muted)',
            border: current === item.id ? '1px solid rgba(var(--accent-rgb, 61,210,255), 0.36)' : '1px solid transparent',
            transition: 'all 0.15s',
            flexShrink: 0,
          }}
          onMouseEnter={(e) => {
            if (current !== item.id) {
              e.currentTarget.style.color = 'var(--text)'
              e.currentTarget.style.background = 'rgba(255,255,255,0.06)'
            }
          }}
          onMouseLeave={(e) => {
            if (current !== item.id) {
              e.currentTarget.style.color = 'var(--muted)'
              e.currentTarget.style.background = 'transparent'
            }
          }}
        >
          {item.label}
        </button>
      ))}

      <div style={{ marginLeft: 16, flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', overflow: 'hidden' }}>
        <PriceTicker />
      </div>

      <div ref={menuRef} style={{ marginLeft: 8, position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setMenuOpen((v) => !v)}
          style={{
            padding: '6px 14px',
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.06em',
            background: menuOpen ? 'rgba(var(--accent-rgb, 61,210,255), 0.14)' : 'transparent',
            color: menuOpen ? 'var(--accent)' : 'var(--muted)',
            border: menuOpen ? '1px solid rgba(var(--accent-rgb, 61,210,255), 0.36)' : '1px solid transparent',
            transition: 'all 0.15s',
            cursor: 'pointer',
          }}
        >
          {me?.username || 'Account'} ▾
        </button>
        {menuOpen && (
          <div style={{
            position: 'absolute',
            right: 0,
            top: 36,
            minWidth: 170,
            background: 'var(--bg2)',
            border: '1px solid var(--border2)',
            padding: 6,
            boxShadow: '0 12px 36px rgba(0,0,0,0.35)',
          }}>
            <button onClick={() => { onNavigate('profile'); setMenuOpen(false) }} style={menuItemStyle}>
              Profile
            </button>
            <button
              onClick={() => {
                setMenuOpen(false)
                if (window.confirm('Confirm logout?')) onLogout()
              }}
              style={{ ...menuItemStyle, color: 'var(--danger)' }}
            >
              Logout
            </button>
          </div>
        )}
      </div>
    </nav>
  )
}

const menuItemStyle: CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '8px 10px',
  background: 'transparent',
  border: '1px solid transparent',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  cursor: 'pointer',
}

const auroraMenuItemStyle: CSSProperties = {
  width: '100%',
  textAlign: 'left',
  padding: '7px 10px',
  background: 'transparent',
  border: 'none',
  color: 'var(--text)',
  fontFamily: 'var(--font-sans)',
  fontSize: '0.72rem',
  fontWeight: 400,
  letterSpacing: '0.02em',
  cursor: 'pointer',
  display: 'block',
}
