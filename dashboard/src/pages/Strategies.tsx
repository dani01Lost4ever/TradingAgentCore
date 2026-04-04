import { useState, useEffect, useRef } from 'react'
import { api } from '../api'
import type { StrategyInfo, ParamDef, AgentConfig } from '../api'

// ── Indicator badges per strategy ─────────────────────────────────────────────
const INDICATOR_BADGES: Record<string, { label: string; color: string }[]> = {
  momentum:       [{ label: 'RSI', color: '#60a5fa' }, { label: 'Volume', color: '#f59e0b' }],
  meanReversion:  [{ label: 'Bollinger Bands', color: '#34d399' }, { label: 'RSI', color: '#60a5fa' }],
  breakout:       [{ label: 'BB', color: '#34d399' }, { label: 'Volume', color: '#f59e0b' }, { label: 'ATR', color: '#f87171' }],
  trendFollowing: [{ label: 'EMA9', color: '#c084fc' }, { label: 'EMA21', color: '#818cf8' }, { label: 'MACD', color: '#f59e0b' }, { label: 'SMA50', color: '#60a5fa' }],
  auto:           [{ label: 'Adaptive', color: 'var(--accent)' }],
  llm:            [{ label: 'AI/LLM', color: '#f87171' }],
}

const STRATEGY_EXPLANATIONS: Record<string, string> = {
  momentum:       'Trades assets showing strong directional momentum using RSI and volume signals.',
  meanReversion:  'Bets that prices revert to the mean after extreme moves using Bollinger Bands.',
  breakout:       'Enters positions when price breaks out of consolidation ranges with volume confirmation.',
  trendFollowing: 'Follows established trends using EMA crossovers, MACD, and SMA filters.',
  auto:           'Automatically selects the best rule-based strategy for each cycle.',
  llm:            'Uses an AI language model to generate trading decisions.',
}

// ── Styles ────────────────────────────────────────────────────────────────────
const card: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)',
  borderRadius: 10, padding: '20px 24px',
}

const monoLabel: React.CSSProperties = {
  fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)',
  letterSpacing: '0.08em', textTransform: 'uppercase',
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        position: 'relative', width: 44, height: 24, borderRadius: 12, padding: 0, flexShrink: 0,
        background: value ? 'var(--accent)' : 'var(--bg3)',
        border: `1px solid ${value ? 'var(--accent)' : 'var(--border2)'}`,
        transition: 'background 0.2s, border-color 0.2s', cursor: 'pointer',
      }}
    >
      <span style={{
        position: 'absolute', top: 3, left: value ? 22 : 3,
        width: 16, height: 16, borderRadius: '50%',
        background: value ? '#000' : 'var(--muted)',
        transition: 'left 0.2s', display: 'block',
      }} />
    </button>
  )
}

// ── ParamField ────────────────────────────────────────────────────────────────
function ParamField({
  def, value, onChange,
}: { def: ParamDef; value: number | boolean | string; onChange: (v: number | boolean | string) => void }) {
  const inputStyle: React.CSSProperties = {
    padding: '6px 10px', background: 'var(--bg3)', border: '1px solid var(--border2)',
    borderRadius: 4, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12,
    outline: 'none', width: '100%', boxSizing: 'border-box',
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ ...monoLabel, display: 'block', marginBottom: 2 }}>{def.label}</label>
      {def.type === 'number' && (
        <input
          type="number"
          value={value as number}
          min={def.min}
          max={def.max}
          step={def.step ?? 1}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          style={inputStyle}
        />
      )}
      {def.type === 'boolean' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Toggle value={value as boolean} onChange={onChange} />
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>
            {value ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      )}
      {def.type === 'select' && (
        <select
          value={value as string}
          onChange={e => onChange(e.target.value)}
          style={inputStyle}
        >
          {(def.options || []).map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
      {def.help && (
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', opacity: 0.7 }}>
          {def.help}
        </span>
      )}
    </div>
  )
}

// ── StrategyCard ──────────────────────────────────────────────────────────────
function StrategyCard({
  strategy, isActive, savedParams, onSelect, onParamsSaved,
}: {
  strategy: StrategyInfo
  isActive: boolean
  savedParams: Record<string, number | boolean | string>
  onSelect: () => void
  onParamsSaved: (id: string, params: Record<string, number | boolean | string>) => void
}) {
  const [open, setOpen]         = useState(false)
  const [params, setParams]     = useState<Record<string, number | boolean | string>>({})
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [saveErr, setSaveErr]   = useState<string | null>(null)
  const [selecting, setSelecting] = useState(false)

  // Initialize params from savedParams or defaults
  useEffect(() => {
    const initial: Record<string, number | boolean | string> = {}
    for (const def of strategy.params) {
      initial[def.key] = savedParams[def.key] ?? def.default
    }
    setParams(initial)
  }, [strategy.params, savedParams])

  const handleReset = () => {
    const defaults: Record<string, number | boolean | string> = {}
    for (const def of strategy.params) {
      defaults[def.key] = def.default
    }
    setParams(defaults)
  }

  const handleSaveParams = async () => {
    setSaving(true); setSaveErr(null); setSaved(false)
    try {
      await api.setStrategyParams(strategy.id, params)
      onParamsSaved(strategy.id, params)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setSaveErr(e.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleSelect = async () => {
    setSelecting(true)
    try {
      await onSelect()
    } finally {
      setSelecting(false)
    }
  }

  const badges = INDICATOR_BADGES[strategy.id] || []

  return (
    <div style={{
      ...card,
      border: isActive ? '1px solid var(--accent)' : '1px solid var(--border)',
      transition: 'border-color 0.2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 14, fontWeight: 700, color: 'var(--text)' }}>
              {strategy.label}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)' }}>
              {strategy.id}
            </span>
            {isActive && (
              <span style={{
                padding: '2px 8px', borderRadius: 4, fontSize: 9, fontFamily: 'var(--font-mono)',
                fontWeight: 700, letterSpacing: '0.08em',
                background: 'rgba(var(--accent-rgb, 0,212,170), 0.15)',
                color: 'var(--accent)', border: '1px solid rgba(var(--accent-rgb, 0,212,170), 0.3)',
              }}>
                ACTIVE
              </span>
            )}
          </div>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', margin: 0, lineHeight: 1.6 }}>
            {strategy.description}
          </p>
        </div>
        <button
          onClick={handleSelect}
          disabled={isActive || selecting}
          style={{
            padding: '7px 16px', borderRadius: 6, fontSize: 11,
            fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', flexShrink: 0,
            background: isActive ? 'rgba(var(--accent-rgb, 0,212,170), 0.15)' : 'var(--accent)',
            color: isActive ? 'var(--accent)' : '#000',
            border: isActive ? '1px solid rgba(var(--accent-rgb, 0,212,170), 0.3)' : 'none',
            cursor: isActive ? 'default' : 'pointer',
            fontWeight: 600, opacity: selecting ? 0.7 : 1,
          }}
        >
          {isActive ? 'Selected' : selecting ? 'Selecting…' : 'Select'}
        </button>
      </div>

      {/* Indicator badges */}
      {badges.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>
          {badges.map(b => (
            <span key={b.label} style={{
              padding: '2px 8px', borderRadius: 4, fontSize: 10,
              fontFamily: 'var(--font-mono)', fontWeight: 600,
              background: `${b.color}22`, color: b.color,
              border: `1px solid ${b.color}44`,
            }}>
              {b.label}
            </span>
          ))}
        </div>
      )}

      {/* Parameters collapsible */}
      {strategy.params.length > 0 && (
        <div>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              background: 'transparent', border: 'none', cursor: 'pointer',
              fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)',
              letterSpacing: '0.06em', padding: '6px 0', display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{ fontSize: 9, transition: 'transform 0.2s', display: 'inline-block', transform: open ? 'rotate(90deg)' : 'rotate(0deg)' }}>▶</span>
            PARAMETERS ({strategy.params.length})
          </button>

          {open && (
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 14, marginBottom: 14 }}>
                {strategy.params.map(def => (
                  <ParamField
                    key={def.key}
                    def={def}
                    value={params[def.key] ?? def.default}
                    onChange={v => setParams(prev => ({ ...prev, [def.key]: v }))}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <button
                  onClick={handleSaveParams}
                  disabled={saving}
                  style={{
                    padding: '7px 18px', background: 'var(--accent)', color: '#000', border: 'none',
                    borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 700,
                    cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1,
                  }}
                >
                  {saving ? 'SAVING…' : 'SAVE PARAMETERS'}
                </button>
                <button
                  onClick={handleReset}
                  style={{
                    padding: '7px 14px', background: 'transparent', color: 'var(--muted)',
                    border: '1px solid var(--border2)', borderRadius: 4,
                    fontFamily: 'var(--font-mono)', fontSize: 11, cursor: 'pointer',
                  }}
                >
                  RESET TO DEFAULTS
                </button>
                {saved    && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)' }}>✓ Saved</span>}
                {saveErr  && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)' }}>✗ {saveErr}</span>}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Main Strategies page ──────────────────────────────────────────────────────
export function Strategies() {
  const [strategies, setStrategies]         = useState<StrategyInfo[]>([])
  const [cfg, setCfg]                       = useState<AgentConfig | null>(null)
  const [loading, setLoading]               = useState(true)
  const [error, setError]                   = useState<string | null>(null)
  const [autoFallback, setAutoFallback]     = useState(false)
  const [fallbackSaving, setFallbackSaving] = useState(false)
  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({})

  useEffect(() => {
    Promise.all([api.listStrategies(), api.getConfig()])
      .then(([{ strategies: s }, c]) => {
        setStrategies(s)
        setCfg(c)
        setAutoFallback(c.autoFallbackToLlm ?? false)
      })
      .catch(e => setError(e.message || 'Failed to load'))
      .finally(() => setLoading(false))
  }, [])

  const activeStrategy = cfg?.activeStrategy ?? 'llm'
  const strategyParams = cfg?.strategyParams ?? {}

  const handleSelect = async (id: string) => {
    const updated = await api.setActiveStrategy(id, autoFallback)
    setCfg(updated)
  }

  const handleParamsSaved = (id: string, params: Record<string, number | boolean | string>) => {
    setCfg(prev => prev ? {
      ...prev,
      strategyParams: { ...prev.strategyParams, [id]: params },
    } : prev)
  }

  const handleFallbackToggle = async (v: boolean) => {
    setAutoFallback(v)
    setFallbackSaving(true)
    try {
      const updated = await api.setActiveStrategy(activeStrategy, v)
      setCfg(updated)
    } finally {
      setFallbackSaving(false)
    }
  }

  const scrollToCard = (id: string) => {
    cardRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const activeInfo = strategies.find(s => s.id === activeStrategy)

  if (loading) {
    return (
      <div style={{ padding: '32px 40px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
        Loading strategies…
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '32px 40px', fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--danger)' }}>
        Error: {error}
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', minHeight: 'calc(100vh - 52px)' }}>
      {/* Sidebar */}
      <aside style={{
        width: 220, flexShrink: 0,
        position: 'sticky', top: 52, height: 'calc(100vh - 52px)', overflowY: 'auto',
        background: 'var(--bg)', borderRight: '1px solid var(--border)',
        padding: '24px 0',
      }}>
        <div style={{ ...monoLabel, padding: '0 20px', marginBottom: 12 }}>STRATEGIES</div>
        {strategies.map(s => {
          const isActive = s.id === activeStrategy
          return (
            <button
              key={s.id}
              onClick={() => scrollToCard(s.id)}
              style={{
                width: '100%', textAlign: 'left', padding: '9px 20px',
                background: isActive ? 'rgba(var(--accent-rgb, 0,212,170), 0.08)' : 'transparent',
                border: 'none', cursor: 'pointer',
                borderLeft: isActive ? '2px solid var(--accent)' : '2px solid transparent',
                transition: 'background 0.15s, border-color 0.15s',
              }}
            >
              <div style={{
                fontFamily: 'var(--font-mono)', fontSize: 12,
                color: isActive ? 'var(--accent)' : 'var(--text)',
                fontWeight: isActive ? 600 : 400,
              }}>
                {s.label}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)', marginTop: 2 }}>
                {s.id}
              </div>
            </button>
          )
        })}
      </aside>

      {/* Main content */}
      <main style={{ flex: 1, padding: '32px 40px', overflowY: 'auto' }}>
        <h2 style={{ margin: '0 0 8px', fontFamily: 'var(--font-mono)', fontSize: 16, letterSpacing: '0.08em', color: 'var(--text)' }}>
          STRATEGIES
        </h2>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', margin: '0 0 28px' }}>
          Select and configure the trading strategy used by the agent.
        </p>

        {/* Active strategy banner */}
        <div style={{
          ...card,
          marginBottom: 24,
          background: 'rgba(var(--accent-rgb, 0,212,170), 0.06)',
          border: '1px solid rgba(var(--accent-rgb, 0,212,170), 0.25)',
        }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...monoLabel, marginBottom: 6, color: 'var(--accent)' }}>CURRENT ACTIVE STRATEGY</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 20, fontWeight: 700, color: 'var(--text)', marginBottom: 6 }}>
                {activeInfo?.label ?? activeStrategy}
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', lineHeight: 1.6 }}>
                {activeInfo?.description ?? STRATEGY_EXPLANATIONS[activeStrategy] ?? 'No description available.'}
              </div>
            </div>

            {/* Auto fallback toggle */}
            <div style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, padding: '14px 18px',
              display: 'flex', flexDirection: 'column', gap: 10, minWidth: 220,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)', marginBottom: 2 }}>
                    Auto Fallback to LLM
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
                    Fall back to AI if no signal found
                  </div>
                </div>
                <Toggle value={autoFallback} onChange={handleFallbackToggle} />
              </div>
              {fallbackSaving && (
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>Saving…</div>
              )}
            </div>
          </div>
        </div>

        {/* Strategy cards */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {strategies.map(s => (
            <div key={s.id} ref={el => { cardRefs.current[s.id] = el }}>
              <StrategyCard
                strategy={s}
                isActive={s.id === activeStrategy}
                savedParams={strategyParams[s.id] ?? {}}
                onSelect={() => handleSelect(s.id)}
                onParamsSaved={handleParamsSaved}
              />
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
