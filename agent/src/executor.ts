import axios from 'axios'
import { Decision } from './brain'

const BASE = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets'

const headers = () => ({
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
  'Content-Type': 'application/json',
})

export interface OrderResult {
  order_id: string
  status: string
  filled_at?: string
  filled_avg_price?: number
}

export async function executeOrder(decision: Decision): Promise<OrderResult> {
  if (decision.action === 'hold') {
    return { order_id: 'HOLD', status: 'skipped' }
  }

  const body = {
    symbol: decision.asset.replace('/', ''),  // BTC/USD → BTCUSD
    notional: decision.amount_usd.toFixed(2), // dollar amount, not qty
    side: decision.action,
    type: 'market',
    time_in_force: 'gtc',
  }

  console.log(`[executor] Placing ${decision.action} order: $${decision.amount_usd} of ${decision.asset}`)

  const res = await axios.post(`${BASE}/v2/orders`, body, { headers: headers() })

  return {
    order_id: res.data.id,
    status: res.data.status,
    filled_at: res.data.filled_at,
    filled_avg_price: res.data.filled_avg_price
      ? parseFloat(res.data.filled_avg_price)
      : undefined,
  }
}

// Cancel a pending order (safety utility)
export async function cancelOrder(orderId: string): Promise<void> {
  await axios.delete(`${BASE}/v2/orders/${orderId}`, { headers: headers() })
  console.log(`[executor] Cancelled order ${orderId}`)
}
