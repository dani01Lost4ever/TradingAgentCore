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
}

const ConfigSchema = new Schema<ConfigRecord>({
  key:         { type: String, default: 'agent', unique: true },
  autoApprove: { type: Boolean, default: false },
  assets:      { type: [String], default: [] },
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
