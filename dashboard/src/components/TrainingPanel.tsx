import { useEffect, useState, useCallback } from 'react'
import { api } from '../api'
import type { TrainingStatus } from '../api'

const STEPS = [
  {
    n: 1,
    title: 'Export dataset',
    desc: 'Click the button below. Requires at least ~50 profitable trades for meaningful fine-tuning.',
  },
  {
    n: 2,
    title: 'Download the JSONL',
    desc: 'Download the exported file and drag it into your Google Drive (or upload directly in Colab).',
  },
  {
    n: 3,
    title: 'Run Colab notebook',
    desc: 'Open training/finetune.ipynb in Google Colab (free T4 GPU works). Update the dataset path and run all cells. No API keys needed.',
    link: 'https://colab.research.google.com',
    linkLabel: 'Open Google Colab →',
  },
  {
    n: 4,
    title: 'Download the GGUF',
    desc: 'Colab will produce a trading-llm.Q4_K_M.gguf file. Download it to your server.',
  },
  {
    n: 5,
    title: 'Deploy to Ollama',
    desc: 'Run training/deploy-ollama.sh on your server. It installs Ollama, registers the model and tests it.',
    code: 'bash training/deploy-ollama.sh /path/to/trading-llm.Q4_K_M.gguf',
  },
  {
    n: 6,
    title: 'Switch the agent',
    desc: 'Update your .env to use the local model and restart the agent.',
    code: 'LLM_PROVIDER=ollama\nOLLAMA_BASE_URL=http://your-server:11434\nOLLAMA_MODEL=trading-llm',
  },
]

function fmt(ts: string) {
  return new Date(ts).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function TrainingPanel() {
  const [status, setStatus] = useState<TrainingStatus | null>(null)
  const [exporting, setExporting] = useState(false)
  const [exportMsg, setExportMsg] = useState('')
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try { setStatus(await api.trainingStatus()) } catch { /* not ready */ }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const id = setInterval(load, 15_000)
    return () => clearInterval(id)
  }, [load])

  async function doExport() {
    setExporting(true)
    setExportMsg('')
    try {
      const r = await api.exportDataset()
      setExportMsg(`✓ Exported ${r.count} samples`)
      load()
    } catch {
      setExportMsg('Export failed')
    } finally {
      setExporting(false)
      setTimeout(() => setExportMsg(''), 5000)
    }
  }

  const providerIsOllama = status?.provider === 'ollama'
  const ready = (status?.datasetSize ?? 0) >= 50

  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>

      {/* Header — always visible */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', padding: '10px 16px', cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--muted)', letterSpacing: '0.08em', flex: 1 }}>
          FINE-TUNING PIPELINE
        </span>

        {/* Provider badge */}
        {status && (
          <span style={{
            fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.06em',
            padding: '2px 8px', borderRadius: 3, marginRight: 10,
            background: providerIsOllama ? 'rgba(129,140,248,0.15)' : 'rgba(0,212,170,0.12)',
            color: providerIsOllama ? 'var(--accent2)' : 'var(--accent)',
            border: `1px solid ${providerIsOllama ? 'rgba(129,140,248,0.3)' : 'rgba(0,212,170,0.25)'}`,
          }}>
            {providerIsOllama ? '⚙ OLLAMA' : '✦ CLAUDE'}
          </span>
        )}

        {/* Dataset size */}
        {status && (
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: ready ? 'var(--green)' : 'var(--warn)', marginRight: 12 }}>
            {status.datasetSize} samples {ready ? '✓' : `(need ${50 - status.datasetSize} more)`}
          </span>
        )}

        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--muted)' }}>
          {open ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '16px 20px' }}>

          {/* Status row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 20 }}>

            <StatusTile label="LLM Provider" value={status?.provider ?? '…'} accent={providerIsOllama ? 'var(--accent2)' : 'var(--accent)'} />
            <StatusTile label="Dataset samples" value={String(status?.datasetSize ?? '…')} accent={ready ? 'var(--green)' : 'var(--warn)'} />
            <StatusTile
              label="Last export"
              value={status?.lastExport ? fmt(status.lastExport) : 'Never'}
              accent="var(--muted)"
            />
            <StatusTile
              label="Ollama"
              value={status?.ollamaReachable ? `✓ ${status.ollamaModel}` : '✗ offline'}
              accent={status?.ollamaReachable ? 'var(--green)' : 'var(--muted)'}
            />
          </div>

          {/* Action buttons */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              onClick={doExport}
              disabled={exporting}
              style={{
                padding: '8px 18px', borderRadius: 5,
                background: 'rgba(0,212,170,0.1)', color: 'var(--accent)',
                border: '1px solid rgba(0,212,170,0.25)', fontWeight: 600, letterSpacing: '0.05em',
              }}
            >
              {exporting ? 'EXPORTING...' : '① EXPORT DATASET'}
            </button>

            <a
              href={api.datasetDownloadUrl()}
              download
              style={{
                padding: '8px 18px', borderRadius: 5, textDecoration: 'none',
                background: status?.lastExportFile ? 'rgba(129,140,248,0.1)' : 'rgba(255,255,255,0.04)',
                color: status?.lastExportFile ? 'var(--accent2)' : 'var(--muted)',
                border: `1px solid ${status?.lastExportFile ? 'rgba(129,140,248,0.25)' : 'var(--border)'}`,
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, letterSpacing: '0.05em',
                pointerEvents: status?.lastExportFile ? 'auto' : 'none',
              }}
            >
              ② DOWNLOAD JSONL
            </a>

            <a
              href="https://colab.research.google.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                padding: '8px 18px', borderRadius: 5, textDecoration: 'none',
                background: 'rgba(255,255,255,0.04)', color: 'var(--muted)',
                border: '1px solid var(--border)',
                fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, letterSpacing: '0.05em',
              }}
            >
              ③ OPEN COLAB ↗
            </a>

            {exportMsg && (
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)' }}>{exportMsg}</span>
            )}
          </div>

          {/* Step guide */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {STEPS.map(step => (
              <div key={step.n} style={{
                display: 'flex', gap: 14, padding: '10px 0',
                borderBottom: '1px solid var(--border)',
              }}>
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)',
                  width: 18, flexShrink: 0, paddingTop: 1,
                }}>
                  {step.n}
                </span>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, marginBottom: 4 }}>
                    {step.title}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.6, marginBottom: step.code || step.link ? 6 : 0 }}>
                    {step.desc}
                  </div>
                  {step.code && (
                    <pre style={{
                      fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent2)',
                      background: 'var(--bg3)', border: '1px solid var(--border)',
                      borderRadius: 4, padding: '6px 10px', overflowX: 'auto',
                    }}>
                      {step.code}
                    </pre>
                  )}
                  {step.link && (
                    <a href={step.link} target="_blank" rel="noopener noreferrer"
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}>
                      {step.linkLabel}
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{ background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 6, padding: '10px 14px' }}>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--muted)', letterSpacing: '0.08em', marginBottom: 4 }}>
        {label}
      </div>
      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 600, color: accent }}>
        {value}
      </div>
    </div>
  )
}
