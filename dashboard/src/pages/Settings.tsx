import { useState, useEffect } from 'react'
import { THEMES, applyTheme, getTheme } from '../theme'
import type { Theme } from '../theme'
import { api } from '../api'

// ── Model catalogue with pricing ───────────────────────────────────────────
const MODELS = [
  { id: 'claude-3-5-haiku-20241022',  label: 'Haiku 3.5',  inputPer1M: 0.80, outputPer1M: 4.00,  note: 'Recommended — fastest & cheapest' },
  { id: 'claude-sonnet-4-20250514',   label: 'Sonnet 4',   inputPer1M: 3.00, outputPer1M: 15.00, note: 'Balanced capability/cost' },
  { id: 'claude-opus-4-20250514',     label: 'Opus 4',     inputPer1M: 15.00,outputPer1M: 75.00, note: 'Most capable — very expensive' },
]

const CYCLE_OPTIONS = [
  { value: 15,  label: '15 min' },
  { value: 30,  label: '30 min' },
  { value: 60,  label: '1 hour' },
  { value: 120, label: '2 hours' },
  { value: 240, label: '4 hours' },
]

// Approximate tokens per call (adjust if your prompt size differs)
const AVG_INPUT_TOKENS  = 3400
const AVG_OUTPUT_TOKENS = 350   // shorter with 15-word reasoning rule

function estimateMonthlyCost(modelId: string, cycleMinutes: number): number {
  const model = MODELS.find(m => m.id === modelId) ?? MODELS[0]
  const callsPerMonth = (60 / cycleMinutes) * 24 * 30
  const inputCost  = (AVG_INPUT_TOKENS  / 1_000_000) * model.inputPer1M
  const outputCost = (AVG_OUTPUT_TOKENS / 1_000_000) * model.outputPer1M
  return (inputCost + outputCost) * callsPerMonth
}

// ── small reusable inputs ──────────────────────────────────────────────────
function NumInput({ label, value, onChange, min, max, step = 0.5, unit = '%', help }: {
  label: string; value: number; onChange: (v: number) => void
  min?: number; max?: number; step?: number; unit?: string; help?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>{label}</label>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="number" value={value} min={min} max={max} step={step}
          onChange={e => onChange(parseFloat(e.target.value) || 0)}
          style={{ width: 90, padding: '6px 10px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4, color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 13, outline: 'none' }}
        />
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>{unit}</span>
      </div>
      {help && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', opacity: 0.7 }}>{help}</span>}
    </div>
  )
}

function Select({ label, value, onChange, options, help }: {
  label: string; value: string | number; onChange: (v: any) => void
  options: { value: string | number; label: string }[]; help?: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <label style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em' }}>{label}</label>
      <select value={value} onChange={e => {
        const raw = e.target.value
        onChange(isNaN(Number(raw)) ? raw : Number(raw))
      }} style={{
        padding: '6px 10px', background: 'var(--bg3)', border: '1px solid var(--border2)', borderRadius: 4,
        color: 'var(--text)', fontFamily: 'var(--font-mono)', fontSize: 12, outline: 'none', cursor: 'pointer',
      }}>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {help && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', opacity: 0.7 }}>{help}</span>}
    </div>
  )
}

// ── main component ─────────────────────────────────────────────────────────
export function Settings() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme())

  const [cfg, setCfg] = useState({
    stopLossPct: 5, takeProfitPct: 10, maxDrawdownPct: 10, maxOpenPositions: 3,
    claudeModel: 'claude-3-5-haiku-20241022', cycleMinutes: 30,
  })
  const [loading, setLoading]   = useState(true)
  const [saving, setSaving]     = useState(false)
  const [saved, setSaved]       = useState(false)
  const [saveErr, setSaveErr]   = useState<string | null>(null)

  useEffect(() => {
    api.getConfig().then(c => {
      setCfg({
        stopLossPct:      c.stopLossPct      ?? 5,
        takeProfitPct:    c.takeProfitPct    ?? 10,
        maxDrawdownPct:   c.maxDrawdownPct   ?? 10,
        maxOpenPositions: c.maxOpenPositions ?? 3,
        claudeModel:      c.claudeModel      ?? 'claude-3-5-haiku-20241022',
        cycleMinutes:     c.cycleMinutes     ?? 30,
      })
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const patch = (key: keyof typeof cfg) => (v: any) => setCfg(prev => ({ ...prev, [key]: v }))

  const handleSave = async () => {
    setSaving(true); setSaveErr(null); setSaved(false)
    try {
      await api.setRiskConfig(cfg)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e: any) {
      setSaveErr(e.message || 'Failed to save')
    } finally { setSaving(false) }
  }

  const monthlyCost   = estimateMonthlyCost(cfg.claudeModel, cfg.cycleMinutes)
  const selectedModel = MODELS.find(m => m.id === cfg.claudeModel)

  return (
    <div style={{ padding: '28px', maxWidth: 780, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ marginBottom: 32 }}>
        <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 16, fontWeight: 600, letterSpacing: '0.04em', color: 'var(--accent)', marginBottom: 6 }}>SETTINGS</h2>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Agent configuration, risk limits and dashboard preferences.</p>
      </div>

      {/* ── LLM & Cycle ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 16 }}>LLM MODEL &amp; CYCLE</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          {loading ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading...</div> : (<>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginBottom: 20 }}>
              <Select
                label="CLAUDE MODEL"
                value={cfg.claudeModel}
                onChange={patch('claudeModel')}
                options={MODELS.map(m => ({ value: m.id, label: `${m.label} — $${m.inputPer1M}/$${m.outputPer1M} per 1M` }))}
                help={selectedModel?.note}
              />
              <Select
                label="CYCLE INTERVAL"
                value={cfg.cycleMinutes}
                onChange={patch('cycleMinutes')}
                options={CYCLE_OPTIONS}
                help="How often the agent wakes up to evaluate the market"
              />
            </div>

            {/* Cost estimate banner */}
            <div style={{
              background: monthlyCost < 5 ? 'rgba(34,197,94,0.07)' : monthlyCost < 20 ? 'rgba(245,158,11,0.07)' : 'rgba(239,68,68,0.07)',
              border: `1px solid ${monthlyCost < 5 ? 'var(--green)' : monthlyCost < 20 ? 'var(--warn)' : 'var(--danger)'}`,
              borderRadius: 6, padding: '12px 16px', marginBottom: 20,
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10,
            }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 4 }}>
                  ESTIMATED MONTHLY API COST
                </div>
                <div style={{
                  fontFamily: 'var(--font-mono)', fontSize: 22, fontWeight: 700,
                  color: monthlyCost < 5 ? 'var(--green)' : monthlyCost < 20 ? 'var(--warn)' : 'var(--danger)',
                }}>
                  ${monthlyCost.toFixed(2)} / month
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
                  ≈ {(60 / cfg.cycleMinutes * 24 * 30).toFixed(0)} calls/month · ~{AVG_INPUT_TOKENS.toLocaleString()} in + ~{AVG_OUTPUT_TOKENS} out tokens per call
                </div>
              </div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', maxWidth: 220, lineHeight: 1.5 }}>
                Actual cost depends on prompt size (number of active assets) and output length. Visit the <span style={{ color: 'var(--accent)' }}>Cost</span> page for real usage.
              </div>
            </div>

            {/* Model comparison table */}
            <div style={{ marginBottom: 20, background: 'var(--bg3)', borderRadius: 6, overflow: 'hidden', border: '1px solid var(--border)' }}>
              {MODELS.map((m, i, arr) => {
                const est = estimateMonthlyCost(m.id, cfg.cycleMinutes)
                const isSelected = m.id === cfg.claudeModel
                return (
                  <div key={m.id} onClick={() => patch('claudeModel')(m.id)} style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px', cursor: 'pointer',
                    background: isSelected ? 'rgba(var(--accent-rgb,0,212,170),0.08)' : 'transparent',
                    borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none',
                    transition: 'background 0.1s',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: isSelected ? 'var(--accent)' : 'var(--border2)', flexShrink: 0 }} />
                      <div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: isSelected ? 'var(--accent)' : 'var(--text)', fontWeight: isSelected ? 700 : 400 }}>{m.label}</div>
                        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>{m.note}</div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: est < 5 ? 'var(--green)' : est < 20 ? 'var(--warn)' : 'var(--danger)', fontWeight: 600 }}>
                        ~${est.toFixed(2)}/mo
                      </div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)' }}>
                        ${m.inputPer1M}/${m.outputPer1M} per 1M
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </>)}
        </div>
      </section>

      {/* ── Risk management ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 16 }}>RISK MANAGEMENT</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, padding: 20 }}>
          {loading ? <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>Loading...</div> : (<>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: 20, marginBottom: 20 }}>
              <NumInput label="STOP LOSS" value={cfg.stopLossPct} onChange={patch('stopLossPct')} min={0.5} max={50} step={0.5} help="Close if price drops this % from entry" />
              <NumInput label="TAKE PROFIT" value={cfg.takeProfitPct} onChange={patch('takeProfitPct')} min={0.5} max={200} step={0.5} help="Close if price rises this % from entry" />
              <NumInput label="MAX DAILY DRAWDOWN" value={cfg.maxDrawdownPct} onChange={patch('maxDrawdownPct')} min={1} max={100} step={1} help="Circuit breaker daily equity drop limit" />
              <NumInput label="MAX OPEN POSITIONS" value={cfg.maxOpenPositions} onChange={patch('maxOpenPositions')} min={1} max={20} step={1} unit="pos" help="Refuse new buys above this limit" />
            </div>
            <div style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid var(--border2)', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', lineHeight: 1.6 }}>
              SL/TP checked every 2 min. Circuit breaker resets daily at midnight UTC. Changes take effect on the next cycle.
            </div>
          </>)}
        </div>
      </section>

      {/* ── Save button ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 36 }}>
        <button onClick={handleSave} disabled={saving || loading} style={{
          padding: '9px 24px', background: 'var(--accent)', color: '#000',
          border: 'none', borderRadius: 4, fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700,
          cursor: saving ? 'wait' : 'pointer', opacity: saving ? 0.7 : 1, letterSpacing: '0.06em',
        }}>
          {saving ? 'SAVING...' : 'SAVE ALL SETTINGS'}
        </button>
        {saved   && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--green)' }}>✓ Saved — cycle interval takes effect after the next run</span>}
        {saveErr && <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)' }}>✗ {saveErr}</span>}
      </div>

      {/* ── Theme ── */}
      <section style={{ marginBottom: 36 }}>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 14 }}>THEME</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
          {THEMES.map(t => {
            const isSelected = currentTheme === t.id
            return (
              <button key={t.id} onClick={() => { applyTheme(t.id); setCurrentTheme(t.id) }} style={{
                padding: 0, border: 'none', background: 'none', borderRadius: 10, overflow: 'hidden',
                outline: isSelected ? `2px solid ${t.accent}` : '2px solid transparent',
                outlineOffset: 2, cursor: 'pointer', transition: 'outline 0.15s', textAlign: 'left',
              }}>
                <div style={{ background: t.bg, padding: '16px 14px', borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 10 }}>
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: t.accent }} />
                    <div style={{ flex: 1, height: 4, borderRadius: 2, background: `${t.accent}44` }} />
                  </div>
                  <div style={{ height: 4, borderRadius: 2, background: `${t.accent}66`, marginBottom: 6 }} />
                  <div style={{ height: 3, borderRadius: 2, background: `${t.accent}33`, marginBottom: 5, width: '70%' }} />
                  <div style={{ height: 3, borderRadius: 2, background: `${t.accent}22`, width: '85%' }} />
                  <div style={{ marginTop: 10, borderRadius: 4, background: `${t.accent}11`, border: `1px solid ${t.accent}22`, padding: '5px 8px' }}>
                    <div style={{ height: 3, borderRadius: 2, background: `${t.accent}55`, width: '60%' }} />
                  </div>
                </div>
                <div style={{ padding: '8px 14px', background: 'var(--bg2)', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: isSelected ? 'var(--accent)' : 'var(--text)', fontWeight: isSelected ? 700 : 400 }}>{t.label}</span>
                  {isSelected && <span style={{ fontSize: 10, color: 'var(--accent)', fontFamily: 'var(--font-mono)' }}>✓</span>}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <div style={{ margin: '32px 0', borderTop: '1px solid var(--border)' }} />

      {/* ── About ── */}
      <section>
        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 14 }}>ABOUT</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
          {[
            { label: 'Dashboard',   value: 'React + Vite + Recharts' },
            { label: 'Agent',       value: 'Node.js + TypeScript' },
            { label: 'LLM',         value: 'Anthropic Claude (configurable)' },
            { label: 'Database',    value: 'MongoDB 4.4' },
            { label: 'Broker',      value: 'Alpaca Paper Trading' },
            { label: 'Data',        value: 'Alpaca Crypto Bars + News · alternative.me F&G' },
            { label: 'Risk',        value: 'ATR sizing · SL/TP monitor · Circuit breaker' },
          ].map((row, i, arr) => (
            <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 16px', borderBottom: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)' }}>{row.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text)' }}>{row.value}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
