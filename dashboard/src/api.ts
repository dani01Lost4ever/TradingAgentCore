const BASE = import.meta.env.VITE_API_URL || ''

export interface AlpacaAsset { symbol: string; name: string }
export interface OHLCBar { t: string; o: number; h: number; l: number; c: number; v: number; vw?: number }

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
  sl_price?: number; tp_price?: number
}
export interface Stats {
  total_decisions: number; executed_trades: number
  profitable_trades: number; win_rate: string
  total_pnl_usd: string; dataset_size: number
}
export interface TradesResponse { trades: Trade[]; total: number; page: number; limit: number }
export interface LogEntry { ts: string; level: 'info' | 'warn' | 'error'; msg: string }
export interface AgentConfig {
  autoApprove: boolean
  stopLossPct: number
  takeProfitPct: number
  maxDrawdownPct: number
  maxOpenPositions: number
  claudeModel: string
  cycleMinutes: number
}
export interface TrainingStatus {
  provider: 'claude' | 'ollama'
  ollamaModel: string; ollamaBase: string; ollamaReachable: boolean
  datasetSize: number; lastExport: string | null; lastExportFile: string | null
}
export interface EquityPoint { ts: string; equity: number; cash: number; peak: number }
export interface PortfolioPosition {
  asset: string; qty: number; entry_price: number; current_price: number
  market_value: number; unrealized_pl: number; unrealized_plpc: number
}
export interface PortfolioDetail {
  cash: number; equity: number; positions: PortfolioPosition[]
}
export interface AssetPnl {
  asset: string; total_pnl: number; trade_count: number; win_rate: number
}
export interface RiskStatus {
  circuitBreakerActive: boolean; circuitBreakerReason?: string
  openPositions: number; todayPnl: number
  maxDrawdownPct: number; maxOpenPositions: number
}
export interface TokenModelStat {
  model: string; input_tokens: number; output_tokens: number; cost_usd: number; calls: number
}
export interface TokenDailyStat {
  date: string; cost_usd: number; input_tokens: number; output_tokens: number; calls: number
}
export interface TokenStats {
  total_calls: number; total_input: number; total_output: number; total_cost: number
  by_model: TokenModelStat[]; daily: TokenDailyStat[]
}
export interface TokenUsageRow {
  _id: string; ts: string; llm_model: string
  input_tokens: number; output_tokens: number; cost_usd: number; context: string
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, opts)
  if (!res.ok) throw new Error(`API error ${res.status}`)
  return res.json()
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export const api = {
  stats:           () => req<Stats>('/api/stats'),
  trades:          (page = 1, limit = 50) => req<TradesResponse>(`/api/trades?page=${page}&limit=${limit}`),
  pending:         () => req<Trade[]>('/api/trades/pending'),
  approve:         (id: string) => req<{success:boolean}>(`/api/trades/${id}/approve`, {method:'POST'}),
  reject:          (id: string) => req<{success:boolean}>(`/api/trades/${id}/reject`, {method:'POST'}),
  exportDataset:   () => req<{success:boolean;count:number}>('/api/dataset/export', {method:'POST'}),
  logs:            (limit = 150) => req<LogEntry[]>(`/api/logs?limit=${limit}`),
  trainingStatus:  () => req<TrainingStatus>('/api/training/status'),
  getConfig:       () => req<AgentConfig>('/api/config'),
  setConfig:       (cfg: Partial<AgentConfig>) => req<AgentConfig>('/api/config', json(cfg)),
  setRiskConfig:   (cfg: Partial<AgentConfig>) => req<AgentConfig>('/api/config/risk', json(cfg)),
  datasetDownloadUrl: () => `${BASE}/api/dataset/download`,

  // Assets
  availableAssets: () => req<AlpacaAsset[]>('/api/assets/available'),
  activeAssets:    () => req<string[]>('/api/assets/active'),
  setActiveAssets: (assets: string[]) => req<string[]>('/api/assets/active', json({ assets })),

  // Charts
  chartBars: (asset: string, timeframe = '1H', limit = 150) =>
    req<OHLCBar[]>(`/api/charts/${encodeURIComponent(asset)}?timeframe=${timeframe}&limit=${limit}`),

  // New features
  equityHistory:   (limit = 200) => req<EquityPoint[]>(`/api/equity/history?limit=${limit}`),
  portfolioDetail: () => req<PortfolioDetail>('/api/portfolio/detail'),
  perAssetPnl:     () => req<AssetPnl[]>('/api/stats/per-asset'),
  riskStatus:      () => req<RiskStatus>('/api/risk/status'),

  // Token / cost tracking
  tokenStats:      () => req<TokenStats>('/api/tokens/stats'),
  tokenHistory:    (limit = 200) => req<TokenUsageRow[]>(`/api/tokens/history?limit=${limit}`),
}

// WebSocket URL — works locally (via Vite proxy) and in Docker (via nginx)
export const WS_URL = (() => {
  const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${window.location.host}/ws`
})()
