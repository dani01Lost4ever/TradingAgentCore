import mongoose, { Schema, Document } from 'mongoose'

export interface AssetSnapshot {
  price: number
  change_24h: number
  volume_24h: number
  high_24h: number
  low_24h: number
  rsi_14?: number
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
})

export const TradeModel = mongoose.model<TradeRecord>('Trade', TradeRecordSchema)
