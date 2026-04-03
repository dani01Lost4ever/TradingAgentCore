import type { Page } from '../App'

const NAV_ITEMS: { id: Page; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview',  icon: '▦' },
  { id: 'charts',   label: 'Charts',    icon: '↗' },
  { id: 'assets',   label: 'Assets',    icon: '⊞' },
  { id: 'tokens',   label: 'Cost',      icon: '◎' },
  { id: 'settings', label: 'Settings',  icon: '⚙' },
]

interface NavProps {
  current: Page
  onNavigate: (page: Page) => void
}

export function Nav({ current, onNavigate }: NavProps) {
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 100,
      background: 'var(--nav-bg)',
      borderBottom: '1px solid var(--nav-border)',
      display: 'flex', alignItems: 'center',
      padding: '0 24px', height: 52,
      gap: 4,
    }}>
      {/* Logo */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginRight: 28 }}>
        <span style={{ fontSize: 18, color: 'var(--accent)', lineHeight: 1 }}>◈</span>
        <span style={{
          fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600,
          color: 'var(--text)', letterSpacing: '0.06em',
        }}>
          TRADING<span style={{ color: 'var(--accent)' }}>AGENT</span>
        </span>
      </div>

      {/* Nav items */}
      {NAV_ITEMS.map(item => (
        <button
          key={item.id}
          onClick={() => onNavigate(item.id)}
          style={{
            padding: '6px 14px',
            borderRadius: 6,
            fontSize: 11,
            fontFamily: 'var(--font-mono)',
            letterSpacing: '0.06em',
            display: 'flex', alignItems: 'center', gap: 7,
            background: current === item.id ? 'rgba(var(--accent-rgb, 0,212,170), 0.1)' : 'transparent',
            color: current === item.id ? 'var(--accent)' : 'var(--muted)',
            border: current === item.id
              ? '1px solid rgba(var(--accent-rgb, 0,212,170), 0.25)'
              : '1px solid transparent',
            transition: 'all 0.15s',
          }}
          onMouseEnter={e => {
            if (current !== item.id) {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--text)'
              ;(e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.04)'
            }
          }}
          onMouseLeave={e => {
            if (current !== item.id) {
              (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted)'
              ;(e.currentTarget as HTMLButtonElement).style.background = 'transparent'
            }
          }}
        >
          <span style={{ fontSize: 13, lineHeight: 1 }}>{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  )
}
