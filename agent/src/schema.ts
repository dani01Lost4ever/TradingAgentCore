import mongoose, { Schema, Document } from 'mongoose'

export interface AssetSnapshot {
  price: number
  change_24h: number
  change_7d?: number       // 7-day price change % (from daily bars)
  volume_24h: number
  volume_sma20?: number    // 20-bar average hourly volume
  high_24h: number
  low_24h: number
  rsi_14?: number
  ema_9?: number           // 9-period EMA (short-term trend)
  ema_21?: number          // 21-period EMA (medium-term trend)
  macd?: number            // MACD line (EMA12 - EMA26)
  macd_signal?: number     // Signal line (EMA9 of MACD)
  macd_hist?: number       // Histogram (MACD - signal)
  bb_upper?: number        // Bollinger Band upper (SMA20 + 2σ)
  bb_lower?: number        // Bollinger Band lower (SMA20 - 2σ)
  bb_pct?: number          // Price position within bands: 0=lower, 1=upper
  atr_14?: number          // Average True Range — volatility in price units
  daily_sma50?: number     // 50-day SMA from daily bars
}

export interface TradeDecision {
  action: 'buy' | 'sell' | 'hold'
  asset: string
  amount_usd: number
  confidence: number
  reasoning: string
}

export interface TradeOutcome {
  pnl_pct: number
  pnl_usd: number
  price_at_resolve: number
  resolved_at: Date
  correct: boolean
}

export interface TradeRecord extends Document {
  timestamp: Date
  market: Record<string, AssetSnapshot>
  portfolio: { cash_usd: number; positions: Record<string, number> }
  decision: TradeDecision
  outcome?: TradeOutcome
  order_id?: string
  approved: boolean
  executed: boolean
  sl_price?: number
  tp_price?: number
  close_reason?: 'sl' | 'tp' | 'manual' | 'timeout'
  closed_at?: Date
}

const TradeRecordSchema = new Schema<TradeRecord>({
  timestamp: { type: Date, default: Date.now, index: true },
  market: { type: Schema.Types.Mixed, required: true },
  portfolio: { type: Schema.Types.Mixed, required: true },
  decision: {
    action: { type: String, enum: ['buy', 'sell', 'hold'], required: true },
    asset: { type: String, required: true },
    amount_usd: { type: Number, required: true },
    confidence: { type: Number, required: true },
    reasoning: { type: String, required: true },
  },
  outcome: {
    pnl_pct: Number,
    pnl_usd: Number,
    price_at_resolve: Number,
    resolved_at: Date,
    correct: Boolean,
  },
  order_id: String,
  approved: { type: Boolean, default: false },
  executed: { type: Boolean, default: false },
  sl_price: { type: Number },
  tp_price: { type: Number },
  close_reason: { type: String, enum: ['sl', 'tp', 'manual', 'timeout'] },
  closed_at: { type: Date },
})

export const TradeModel = mongoose.model<TradeRecord>('Trade', TradeRecordSchema)

// ─── Agent config (single document, upserted by key) ─────────────────────────
export interface ConfigRecord extends Document {
  key: string
  autoApprove: boolean
  assets: string[]
  [key: string]: any
}

const ConfigSchema = new Schema<ConfigRecord>({
  key:                 { type: String, default: 'agent', unique: true },
  autoApprove:         { type: Boolean, default: false },
  assets:              { type: [String], default: [] },
  stopLossPct:         { type: Number, default: 5 },
  takeProfitPct:       { type: Number, default: 10 },
  maxDrawdownPct:      { type: Number, default: 10 },
  maxOpenPositions:    { type: Number, default: 3 },
  claudeModel:         { type: String, default: '' },
  cycleMinutes:        { type: Number, default: 30 },
  confidenceThreshold: { type: Number, default: 0 },
  kellyEnabled:        { type: Boolean, default: false },
  consensusMode:       { type: Boolean, default: false },
  consensusModel:      { type: String, default: '' },
  trailingStopEnabled: { type: Boolean, default: false },
  trailingStopPct:     { type: Number, default: 2.5 },
})

export const ConfigModel = mongoose.model<ConfigRecord>('Config', ConfigSchema)

// ─── Equity snapshots (for drawdown chart) ───────────────────────────────────
export interface EquitySnapshotDoc extends Document {
  ts: Date
  equity: number
  cash: number
  peak: number
}

const EquitySnapshotSchema = new Schema<EquitySnapshotDoc>({
  ts:     { type: Date, default: Date.now, index: true },
  equity: { type: Number, required: true },
  cash:   { type: Number, required: true },
  peak:   { type: Number, required: true },
})

export const EquityModel = mongoose.model<EquitySnapshotDoc>('EquitySnapshot', EquitySnapshotSchema)

// ─── Token usage (LLM cost tracking) ─────────────────────────────────────────
export interface TokenUsageDoc extends Document {
  ts: Date
  llm_model: string
  input_tokens: number
  output_tokens: number
  cost_usd: number
  context: string   // e.g. 'trade_decision'
}

const TokenUsageSchema = new Schema<TokenUsageDoc>({
  ts:            { type: Date, default: Date.now, index: true },
  llm_model:     { type: String, required: true },
  input_tokens:  { type: Number, required: true },
  output_tokens: { type: Number, required: true },
  cost_usd:      { type: Number, required: true },
  context:       { type: String, default: 'trade_decision' },
})

export const TokenUsageModel = mongoose.model<TokenUsageDoc>('TokenUsage', TokenUsageSchema)

// ─── Users (for auth) ────────────────────────────────────────────────────────
export interface UserDoc extends Document {
  username: string
  passwordHash: string
}

const UserSchema = new Schema<UserDoc>({
  username:     { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
})

export const UserModel = mongoose.model<UserDoc>('User', UserSchema)

// ─── API Keys (stored in DB, editable from dashboard) ────────────────────────
export interface ApiKeyDoc extends Document {
  key: string
  value: string
}

const ApiKeySchema = new Schema<ApiKeyDoc>({
  key:   { type: String, required: true, unique: true },
  value: { type: String, required: true },
})

export const ApiKeyModel = mongoose.model<ApiKeyDoc>('ApiKey', ApiKeySchema)

// BacktestResult
export interface BacktestTradeDoc {
  ts: Date; asset: string; action: 'buy'|'sell'|'hold'
  price: number; amount_usd: number; confidence: number; pnl_usd: number
}
export interface BacktestResultDoc extends Document {
  runAt: Date
  params: { assets: string[]; startDate: string; endDate: string; cycleHours: number; model: string; mode: 'rules'|'llm' }
  trades: BacktestTradeDoc[]
  startEquity: number; finalEquity: number
  totalReturn: number; maxDrawdown: number; winRate: number; totalTrades: number
  sharpe?: number
  sortino?: number
}
const BacktestResultSchema = new Schema<BacktestResultDoc>({
  runAt: { type: Date, default: Date.now },
  params: Schema.Types.Mixed,
  trades: [Schema.Types.Mixed],
  startEquity: Number, finalEquity: Number,
  totalReturn: Number, maxDrawdown: Number, winRate: Number, totalTrades: Number,
  sharpe: Number, sortino: Number,
})
export const BacktestResultModel = mongoose.model<BacktestResultDoc>('BacktestResult', BacktestResultSchema)

// ─── PositionHigh (trailing stop high water marks) ────────────────────────────
export interface PositionHighDoc extends Document {
  asset: string
  tradeId: string
  highPrice: number
  updatedAt: Date
}
const PositionHighSchema = new Schema<PositionHighDoc>({
  asset:     { type: String, required: true },
  tradeId:   { type: String, required: true, unique: true },
  highPrice: { type: Number, required: true },
  updatedAt: { type: Date, default: Date.now },
})
export const PositionHighModel = mongoose.model<PositionHighDoc>('PositionHigh', PositionHighSchema)

// AuditLog
export interface AuditLogDoc extends Document {
  ts: Date; user: string; action: string; details: string; ip?: string
}
const AuditLogSchema = new Schema<AuditLogDoc>({
  ts: { type: Date, default: Date.now, index: true },
  user: { type: String, default: 'system' },
  action: { type: String, required: true },
  details: String,
  ip: String,
})
export const AuditLogModel = mongoose.model<AuditLogDoc>('AuditLog', AuditLogSchema)

// PromptRecord (stores custom system prompt)
export interface PromptDoc extends Document {
  key: string; value: string; updatedAt: Date
}
const PromptSchema = new Schema<PromptDoc>({
  key: { type: String, required: true, unique: true },
  value: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
})
export const PromptModel = mongoose.model<PromptDoc>('Prompt', PromptSchema)
