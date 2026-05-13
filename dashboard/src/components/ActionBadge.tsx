
interface Props { action: 'buy' | 'sell' | 'hold' }

// aurora-dark pill styles follow the mockup exactly
const AURORA_MAP = {
  buy:  { color: 'var(--accent)',  bg: 'rgba(200,255,0,0.15)',      border: 'rgba(200,255,0,0.3)',      label: 'BUY'  },
  sell: { color: 'var(--danger)',  bg: 'rgba(217,79,61,0.14)',      border: 'rgba(217,79,61,0.3)',      label: 'SELL' },
  hold: { color: 'var(--muted)',   bg: 'rgba(122,127,138,0.12)',    border: 'rgba(122,127,138,0.2)',    label: 'HOLD' },
}

// legacy (non-aurora) pill styles — keep existing colours
const LEGACY_MAP = {
  buy:  { color: 'var(--green)',  bg: 'rgba(34,197,94,0.12)',  border: 'transparent', label: 'BUY'  },
  sell: { color: 'var(--danger)', bg: 'rgba(255,77,109,0.12)', border: 'transparent', label: 'SELL' },
  hold: { color: 'var(--muted)',  bg: 'rgba(90,106,122,0.12)', border: 'transparent', label: 'HOLD' },
}

function isAuroraDark(): boolean {
  return document.documentElement.getAttribute('data-theme') === 'aurora-dark'
}

export function ActionBadge({ action }: Props) {
  const map = isAuroraDark() ? AURORA_MAP : LEGACY_MAP
  const s = map[action]
  return (
    <span style={{
      fontFamily: 'var(--font-mono)',
      fontSize: 11,
      fontWeight: 700,
      color: s.color,
      background: s.bg,
      border: `1px solid ${s.border}`,
      padding: '2px 7px',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      display: 'inline-block',
      fontVariantNumeric: 'tabular-nums',
    }}>
      {s.label}
    </span>
  )
}
