

interface Props { action: 'buy' | 'sell' | 'hold' }

const MAP = {
  buy:  { color: 'var(--green)',  bg: 'rgba(34,197,94,0.12)',  label: 'BUY'  },
  sell: { color: 'var(--danger)', bg: 'rgba(255,77,109,0.12)', label: 'SELL' },
  hold: { color: 'var(--muted)',  bg: 'rgba(90,106,122,0.12)', label: 'HOLD' },
}

export function ActionBadge({ action }: Props) {
  const s = MAP[action]
  return (
    <span style={{
      fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
      color: s.color, background: s.bg,
      padding: '2px 8px', borderRadius: 3,
      letterSpacing: '0.06em',
    }}>
      {s.label}
    </span>
  )
}
