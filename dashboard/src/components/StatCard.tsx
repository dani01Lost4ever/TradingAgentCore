
interface Props {
  label: string
  value: string | number
  sub?: string
  accent?: 'green' | 'danger' | 'warn' | 'accent' | 'accent2'
  mono?: boolean
}

function isAuroraDark(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'aurora-dark'
}

export function StatCard({ label, value, sub, accent, mono }: Props) {
  const color = accent ? `var(--${accent})` : 'var(--text)'

  if (isAuroraDark()) {
    return (
      <div className="aurora-stat-cell aurora-fade-2">
        <div className="aurora-stat-label">{label}</div>
        <div
          className="aurora-stat-val aurora-tnum"
          style={{ color }}
        >
          {value}
        </div>
        {sub && (
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: '0.6rem', color: 'var(--muted)', marginTop: 4 }}>
            {sub}
          </div>
        )}
      </div>
    )
  }

  return (
    <div style={{
      background: 'var(--bg2)',
      border: '1px solid var(--border)',
      padding: '18px 22px',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      animation: 'fadeUp 0.3s ease both',
    }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
        {label}
      </span>
      <span style={{
        fontFamily: mono !== false ? 'var(--font-mono)' : 'var(--font-sans)',
        fontSize: 26,
        fontWeight: 600,
        color,
        lineHeight: 1.1,
      }}>
        {value}
      </span>
      {sub && (
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{sub}</span>
      )}
    </div>
  )
}
