const BASE = import.meta.env.VITE_API_URL || ''

export interface AssetSnapshot {
  price: number; change_24h: number; volume_24h: number
  high_24h: number; low_24h: number; rsi_14?: number
}
export interface TradeDecision {
  action: 'buy' | 'sell' | 'hold'; asset: string
  amount_usd: number; confidence: number; reasoning: string
}
export interface TradeOutcome {
  pnl_pct: number; pnl_usd: number; price_at_resolve: number
  resolved_at: string; correct: boolean
}
export interface Trade {
  _id: string; timestamp: string
  market: Record<string, AssetSnapshot>
  portfolio: { cash_usd: number; positions: Record<string, number> }
  decision: TradeDecision; outcome?: TradeOutcome
  order_id?: string; approved: boolean; executed: boolean
}
export interface Stats {
  total_decisions: number; executed_trades: number
  profitable_trades: number; win_rate: string
  total_pnl_usd: string; dataset_size: number
}
export interface TradesResponse { trades: Trade[]; total: number; page: number; limit: number }
export interface LogEntry { ts: string; level: 'info' | 'warn' | 'error'; msg: string }
export interface AgentConfig { autoApprove: boolean }
export interface TrainingStatus {
  provider: 'claude' | 'ollama'
  ollamaModel: string
  ollamaBase: string
  ollamaReachable: boolean
  datasetSize: number
  lastExport: string | null
  lastExportFile: string | null
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

export const api = {
  stats: () => req<Stats>('/api/stats'),
  trades: (page = 1, limit = 50) => req<TradesResponse>(`/api/trades?page=${page}&limit=${limit}`),
  pending: () => req<Trade[]>('/api/trades/pending'),
  approve: (id: string) => req<{success:boolean}>(`/api/trades/${id}/approve`, {method:'POST'}),
  reject: (id: string) => req<{success:boolean}>(`/api/trades/${id}/reject`, {method:'POST'}),
  exportDataset: () => req<{success:boolean;count:number}>('/api/dataset/export', {method:'POST'}),
  logs: (limit = 150) => req<LogEntry[]>(`/api/logs?limit=${limit}`),
  trainingStatus: () => req<TrainingStatus>('/api/training/status'),
  getConfig: () => req<AgentConfig>('/api/config'),
  setConfig: (cfg: Partial<AgentConfig>) => req<AgentConfig>('/api/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(cfg),
  }),
  datasetDownloadUrl: () => `${BASE}/api/dataset/download`,
}
