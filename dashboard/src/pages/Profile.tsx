import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { AuthUser, WalletInfo } from '../api'

// ── Shared input style ────────────────────────────────────────────────────────
const inp = {
  padding: '7px 10px',
  background: 'var(--bg3)',
  border: '1px solid var(--border2)',
  borderRadius: 0,
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box' as const,
  fontVariantNumeric: 'tabular-nums',
}

const btnStyle = {
  padding: '6px 12px',
  borderRadius: 0,
  border: '1px solid var(--border2)',
  background: 'transparent',
  color: 'var(--text)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  cursor: 'pointer',
  letterSpacing: '0.05em',
}

const btnPrimary = {
  padding: '8px 16px',
  borderRadius: 0,
  border: '1px solid var(--accent)',
  background: 'var(--accent)',
  color: '#000',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 700,
  cursor: 'pointer',
  letterSpacing: '0.06em',
}

const btnDanger = {
  ...btnStyle,
  color: 'var(--danger)',
  border: '1px solid rgba(217,79,61,0.4)',
}

// ── Exchange types ────────────────────────────────────────────────────────────
type ExchangeKind = 'alpaca' | 'binance' | 'coinbase' | 'ibkr' | 'bitpanda'

// ── Rotate Credentials Modal ──────────────────────────────────────────────────
function RotateCredentialsModal({ wallet, onClose }: { wallet: WalletInfo; onClose: () => void }) {
  const exchange = (wallet as any).exchange as ExchangeKind || 'alpaca'
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const setField = (key: string, val: string) =>
    setFields(prev => ({ ...prev, [key]: val }))

  const handleSave = async () => {
    setSaving(true)
    setMsg(null)
    try {
      await api.rotateWalletCredentials(wallet.id, fields)
      setMsg({ ok: true, text: 'Credentials updated successfully' })
      setTimeout(() => onClose(), 1500)
    } catch (e: any) {
      setMsg({ ok: false, text: e.message || 'Failed to update credentials' })
    } finally {
      setSaving(false)
    }
  }

  const fieldRow = (label: string, key: string, type: 'text' | 'password' = 'password', placeholder?: string) => (
    <div key={key} style={{ marginBottom: 12 }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>{label}</div>
      <input
        type={type}
        value={fields[key] ?? ''}
        onChange={e => setField(key, e.target.value)}
        placeholder={placeholder ?? 'New value...'}
        style={inp}
      />
    </div>
  )

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.72)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 2000 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: 'var(--bg2)', border: '1px solid var(--border2)', width: 480, maxWidth: '92vw', padding: '24px 28px' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>ROTATE CREDENTIALS</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>{wallet.name} · {exchange.toUpperCase()}</div>
          </div>
          <button onClick={onClose} style={{ ...btnStyle, padding: '4px 10px' }}>✕</button>
        </div>

        <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--warn)', marginBottom: 16, lineHeight: 1.6 }}>
          Leave any field blank to keep the current value. Only provided fields will be updated.
        </div>

        {exchange === 'alpaca' && <>
          {fieldRow('ALPACA API KEY', 'alpaca_api_key', 'password', 'New Alpaca API key...')}
          {fieldRow('ALPACA API SECRET', 'alpaca_api_secret', 'password', 'New Alpaca secret...')}
          {fieldRow('ALPACA BASE URL', 'alpaca_base_url', 'text', 'https://paper-api.alpaca.markets')}
        </>}
        {exchange === 'binance' && <>
          {fieldRow('BINANCE API KEY', 'binance_api_key', 'password')}
          {fieldRow('BINANCE API SECRET', 'binance_api_secret', 'password')}
        </>}
        {exchange === 'coinbase' && <>
          {fieldRow('COINBASE CDP API KEY NAME', 'coinbase_api_key', 'text')}
          {fieldRow('COINBASE PRIVATE KEY (PEM)', 'coinbase_api_secret', 'password')}
        </>}
        {exchange === 'ibkr' && <>
          {fieldRow('IBKR GATEWAY URL', 'ibkr_gateway_url', 'text', 'http://localhost:5000')}
          {fieldRow('IBKR SESSION TOKEN', 'ibkr_session_token', 'password')}
        </>}
        {exchange === 'bitpanda' && <>
          {fieldRow('BITPANDA API KEY', 'bitpanda_api_key', 'password')}
          {fieldRow('BITPANDA API SECRET', 'bitpanda_api_secret', 'password')}
        </>}

        {msg && (
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: msg.ok ? 'var(--green)' : 'var(--danger)', marginBottom: 12 }}>
            {msg.ok ? '✓' : '✗'} {msg.text}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
          <button onClick={handleSave} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'SAVING...' : 'UPDATE CREDENTIALS'}
          </button>
          <button onClick={onClose} style={btnStyle}>CANCEL</button>
        </div>
      </div>
    </div>
  )
}

// ── Wallet row ────────────────────────────────────────────────────────────────
function WalletRow({ wallet, onRefresh }: { wallet: WalletInfo; onRefresh: () => void }) {
  const [rotating, setRotating] = useState(false)
  const [cycling, setCycling] = useState(false)
  const [cycleMsg, setCycleMsg] = useState<{ ok: boolean; text: string } | null>(null)

  const modeColor = (wallet as any).mode === 'live' ? 'var(--danger)' : 'var(--green)'

  const handleRunCycle = async () => {
    if (cycling) return
    setCycling(true)
    setCycleMsg(null)
    try {
      const res = await api.triggerWalletCycle(wallet.id)
      setCycleMsg({ ok: true, text: res.message })
    } catch (e: any) {
      setCycleMsg({ ok: false, text: e.message || 'Failed to trigger cycle' })
    } finally {
      setCycling(false)
      setTimeout(() => setCycleMsg(null), 5000)
    }
  }

  return (
    <>
      {rotating && (
        <RotateCredentialsModal wallet={wallet} onClose={() => { setRotating(false); onRefresh() }} />
      )}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--text)', display: 'flex', alignItems: 'center', gap: 10 }}>
            {wallet.name}
            {wallet.active && <span style={{ color: 'var(--accent)', fontSize: 9, letterSpacing: '0.08em' }}>[ACTIVE]</span>}
            <span style={{ fontSize: 9, fontWeight: 700, color: modeColor, border: `1px solid ${modeColor}`, padding: '1px 6px', letterSpacing: '0.06em' }}>
              {(wallet as any).mode?.toUpperCase() ?? 'PAPER'}
            </span>
            <span style={{ fontSize: 9, color: 'var(--muted)', letterSpacing: '0.05em', border: '1px solid var(--border2)', padding: '1px 6px' }}>
              {((wallet as any).exchange ?? 'alpaca').toUpperCase()}
            </span>
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
            {wallet.alpaca_api_key_masked ? `Key ${wallet.alpaca_api_key_masked} · Secret ${wallet.alpaca_api_secret_masked}` : 'Credentials stored'}
          </div>
          {cycleMsg && (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: cycleMsg.ok ? 'var(--green)' : 'var(--danger)', marginTop: 4 }}>
              {cycleMsg.ok ? '✓' : '✗'} {cycleMsg.text}
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {wallet.active && (
            <button
              onClick={handleRunCycle}
              disabled={cycling}
              style={{
                ...btnStyle,
                color: cycling ? 'var(--muted)' : 'var(--accent)',
                border: cycling ? '1px solid var(--border)' : '1px solid rgba(200,255,0,0.35)',
                cursor: cycling ? 'not-allowed' : 'pointer',
                letterSpacing: '0.05em',
              }}
            >
              {cycling ? 'RUNNING...' : 'RUN CYCLE NOW'}
            </button>
          )}
          <button onClick={() => setRotating(true)} style={{ ...btnStyle, color: 'var(--accent)', border: '1px solid rgba(200,255,0,0.25)' }}>
            ROTATE KEYS
          </button>
          {!wallet.active && (
            <button onClick={async () => { await api.activateWallet(wallet.id); onRefresh() }} style={btnStyle}>
              SWITCH
            </button>
          )}
          <button onClick={async () => {
            if (!window.confirm(`Delete wallet "${wallet.name}"?`)) return
            await api.deleteWallet(wallet.id)
            onRefresh()
          }} style={btnDanger}>
            DELETE
          </button>
        </div>
      </div>
    </>
  )
}

// ── Dropdown ──────────────────────────────────────────────────────────────────
function Dropdown<T extends string>({ value, onChange, options }: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: string }[]
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} style={{ flex: 1, position: 'relative', userSelect: 'none' }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{
          padding: '7px 10px',
          background: 'var(--bg3)',
          border: `1px solid ${open ? 'var(--accent)' : 'var(--border2)'}`,
          borderRadius: 0,
          color: 'var(--text)',
          fontFamily: 'var(--font-mono)',
          fontSize: 11,
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <span>{selected?.label}</span>
        <span style={{ color: 'var(--muted)', fontSize: 9 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          background: 'var(--bg3)',
          border: '1px solid var(--border2)',
          borderTop: 'none',
          zIndex: 100,
        }}>
          {options.map(o => (
            <div
              key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              style={{
                padding: '7px 10px',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                color: o.value === value ? 'var(--accent)' : 'var(--text)',
                background: o.value === value ? 'rgba(200,255,0,0.06)' : 'transparent',
                cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
              }}
            >
              {o.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main Profile component ────────────────────────────────────────────────────
export function Profile({ me }: { me: AuthUser | null }) {
  const [wallets, setWallets] = useState<WalletInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState('')
  // Alpaca
  const [alpacaKey, setAlpacaKey] = useState('')
  const [alpacaSecret, setAlpacaSecret] = useState('')
  const [alpacaBase, setAlpacaBase] = useState('https://paper-api.alpaca.markets')
  // Binance
  const [binanceKey, setBinanceKey] = useState('')
  const [binanceSecret, setBinanceSecret] = useState('')
  // Coinbase
  const [coinbaseKey, setCoinbaseKey] = useState('')
  const [coinbaseSecret, setCoinbaseSecret] = useState('')
  // IBKR
  const [ibkrGatewayUrl, setIbkrGatewayUrl] = useState('http://localhost:5000')
  const [ibkrSessionToken, setIbkrSessionToken] = useState('')
  // Bitpanda
  const [bitpandaApiKey, setBitpandaApiKey] = useState('')
  const [bitpandaApiSecret, setBitpandaApiSecret] = useState('')
  // Form state
  const [exchange, setExchange] = useState<ExchangeKind>('alpaca')
  const [walletMode, setWalletMode] = useState<'paper' | 'live'>('paper')
  const [saving, setSaving] = useState(false)

  const loadWallets = async () => {
    try {
      setError(null)
      const res = await api.wallets()
      setWallets(res.wallets)
    } catch (e: any) {
      setError(e.message || 'Failed to load wallets')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadWallets().catch(() => {}) }, [])

  const clearForm = () => {
    setName('')
    setAlpacaKey(''); setAlpacaSecret(''); setAlpacaBase('https://paper-api.alpaca.markets')
    setBinanceKey(''); setBinanceSecret('')
    setCoinbaseKey(''); setCoinbaseSecret('')
    setIbkrGatewayUrl('http://localhost:5000'); setIbkrSessionToken('')
    setBitpandaApiKey(''); setBitpandaApiSecret('')
    setExchange('alpaca')
    setWalletMode('paper')
  }

  const onCreate = async () => {
    if (!name.trim()) return
    if (exchange === 'alpaca' && (!alpacaKey.trim() || !alpacaSecret.trim())) return
    setSaving(true)
    try {
      await api.createWallet({
        name: name.trim(),
        exchange,
        mode: walletMode,
        // Alpaca
        alpaca_api_key:    alpacaKey.trim(),
        alpaca_api_secret: alpacaSecret.trim(),
        alpaca_base_url:   alpacaBase.trim() || 'https://paper-api.alpaca.markets',
        // Binance
        binance_api_key:    binanceKey,
        binance_api_secret: binanceSecret,
        // Coinbase
        coinbase_api_key:    coinbaseKey,
        coinbase_api_secret: coinbaseSecret,
        // IBKR
        ibkr_gateway_url:    ibkrGatewayUrl,
        ibkr_session_token:  ibkrSessionToken,
        // Bitpanda
        bitpanda_api_key:    bitpandaApiKey,
        bitpanda_api_secret: bitpandaApiSecret,
      })
      clearForm()
      await loadWallets()
    } catch (e: any) {
      setError(e.message || 'Failed to create wallet')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ padding: 28, maxWidth: 980, margin: '0 auto' }}>
      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <h2 className="aurora-section-title" style={{ marginBottom: 6, fontSize: '0.7rem' }}>PROFILE</h2>
        <p style={{ fontFamily: 'var(--font-mono)', color: 'var(--muted)', fontSize: 11 }}>
          User: <span style={{ color: 'var(--text)' }}>{me?.username || '—'}</span> · Wallets are used by the trading engine for order execution.
        </p>
      </div>

      {loading && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', marginBottom: 12 }}>Loading...</div>}
      {error && <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--danger)', marginBottom: 12 }}>{error}</div>}

      {/* Wallets list */}
      <section style={{ marginBottom: 20 }}>
        <div className="aurora-section-title">WALLETS</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)' }}>
          {wallets.length === 0 && !loading ? (
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', padding: '16px' }}>No wallets yet.</div>
          ) : (
            wallets.map(w => (
              <WalletRow key={w.id} wallet={w} onRefresh={() => loadWallets().catch(() => {})} />
            ))
          )}
        </div>
      </section>

      {/* Add wallet form */}
      <section>
        <div className="aurora-section-title">ADD WALLET</div>
        <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', padding: '20px' }}>
          {/* Name */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>WALLET NAME</div>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. My Paper Account" style={inp} />
          </div>

          {/* Exchange + Mode */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>EXCHANGE</div>
              <Dropdown<ExchangeKind>
                value={exchange}
                onChange={setExchange}
                options={[
                  { value: 'alpaca',   label: 'Alpaca' },
                  { value: 'binance',  label: 'Binance' },
                  { value: 'coinbase', label: 'Coinbase' },
                  { value: 'ibkr',     label: 'IBKR' },
                  { value: 'bitpanda', label: 'Bitpanda' },
                ]}
              />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>MODE</div>
              <Dropdown<'paper' | 'live'>
                value={walletMode}
                onChange={setWalletMode}
                options={[{ value: 'paper', label: 'Paper' }, { value: 'live', label: 'Live' }]}
              />
            </div>
          </div>

          {/* Exchange-specific credentials */}
          {exchange === 'alpaca' && (
            <div style={{ marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>BASE URL</div>
                <input value={alpacaBase} onChange={e => setAlpacaBase(e.target.value)} placeholder="https://paper-api.alpaca.markets" style={inp} />
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>API KEY</div>
                <input value={alpacaKey} onChange={e => setAlpacaKey(e.target.value)} placeholder="PKXXXX..." style={inp} />
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>API SECRET</div>
                <input type="password" value={alpacaSecret} onChange={e => setAlpacaSecret(e.target.value)} placeholder="Secret key" style={inp} />
              </div>
            </div>
          )}

          {exchange === 'binance' && (
            <div style={{ marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>BINANCE API KEY</div>
                <input value={binanceKey} onChange={e => setBinanceKey(e.target.value)} style={inp} />
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>BINANCE API SECRET</div>
                <input type="password" value={binanceSecret} onChange={e => setBinanceSecret(e.target.value)} style={inp} />
              </div>
            </div>
          )}

          {exchange === 'coinbase' && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>COINBASE CDP API KEY NAME</div>
                <input value={coinbaseKey} onChange={e => setCoinbaseKey(e.target.value)} style={inp} />
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>COINBASE PRIVATE KEY (PEM)</div>
                <textarea
                  value={coinbaseSecret}
                  onChange={e => setCoinbaseSecret(e.target.value)}
                  placeholder="-----BEGIN EC PRIVATE KEY-----..."
                  rows={4}
                  style={{ ...inp, resize: 'vertical', lineHeight: 1.5 }}
                />
              </div>
            </div>
          )}

          {exchange === 'ibkr' && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>IBKR GATEWAY URL</div>
                <input value={ibkrGatewayUrl} onChange={e => setIbkrGatewayUrl(e.target.value)} placeholder="http://localhost:5000" style={inp} />
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)', marginTop: 4, lineHeight: 1.5, opacity: 0.8 }}>
                  Run the IBKR Client Portal Gateway locally and paste your session cookie from devtools.
                </div>
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>IBKR SESSION TOKEN</div>
                <input type="password" value={ibkrSessionToken} onChange={e => setIbkrSessionToken(e.target.value)} placeholder="Session cookie value" style={inp} />
              </div>
            </div>
          )}

          {exchange === 'bitpanda' && (
            <div style={{ marginBottom: 14, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>BITPANDA API KEY</div>
                <input type="password" value={bitpandaApiKey} onChange={e => setBitpandaApiKey(e.target.value)} style={inp} />
              </div>
              <div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.06em', marginBottom: 5 }}>BITPANDA API SECRET</div>
                <input type="password" value={bitpandaApiSecret} onChange={e => setBitpandaApiSecret(e.target.value)} style={inp} />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--muted)', lineHeight: 1.5, opacity: 0.8 }}>
                  API key from your Bitpanda Pro account. Bitpanda Pro has no paper mode — use Alpaca paper for testing.
                </div>
              </div>
            </div>
          )}

          <button onClick={onCreate} disabled={saving} style={{ ...btnPrimary, opacity: saving ? 0.7 : 1 }}>
            {saving ? 'SAVING...' : 'ADD WALLET'}
          </button>
        </div>
      </section>
    </div>
  )
}
