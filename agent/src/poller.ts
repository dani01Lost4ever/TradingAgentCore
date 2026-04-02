import axios from 'axios'
import { AssetSnapshot } from './schema'

const BASE = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets'
const DATA = 'https://data.alpaca.markets'

const headers = () => ({
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
})

export interface Portfolio {
  cash_usd: number
  positions: Record<string, number> // asset → qty
  equity_usd: number
}

// Fetch current portfolio from Alpaca paper account
export async function fetchPortfolio(): Promise<Portfolio> {
  const [accountRes, positionsRes] = await Promise.all([
    axios.get(`${BASE}/v2/account`, { headers: headers() }),
    axios.get(`${BASE}/v2/positions`, { headers: headers() }),
  ])

  const positions: Record<string, number> = {}
  for (const p of positionsRes.data) {
    positions[p.symbol] = parseFloat(p.qty)
  }

  return {
    cash_usd: parseFloat(accountRes.data.cash),
    equity_usd: parseFloat(accountRes.data.equity),
    positions,
  }
}

// Fetch latest bar + compute basic RSI(14) from recent bars
export async function fetchMarketSnapshot(
  assets: string[]
): Promise<Record<string, AssetSnapshot>> {
  const snapshot: Record<string, AssetSnapshot> = {}

  for (const asset of assets) {
    try {
      // Latest quote
      const barRes = await axios.get(
        `${DATA}/v1beta3/crypto/us/bars`,
        {
          headers: headers(),
          params: { symbols: asset, timeframe: '1H', limit: 20 },
        }
      )

      const bars: any[] = barRes.data.bars[asset] || []
      if (!bars.length) continue

      const latest = bars[bars.length - 1]
      const prev24h = bars.length >= 24 ? bars[bars.length - 24] : bars[0]

      const rsi = computeRSI(bars.map((b: any) => b.c), 14)

      snapshot[asset] = {
        price: latest.c,
        change_24h: parseFloat(
          (((latest.c - prev24h.o) / prev24h.o) * 100).toFixed(2)
        ),
        volume_24h: bars.slice(-24).reduce((s: number, b: any) => s + b.v, 0),
        high_24h: Math.max(...bars.slice(-24).map((b: any) => b.h)),
        low_24h: Math.min(...bars.slice(-24).map((b: any) => b.l)),
        rsi_14: rsi,
      }
    } catch (err: any) {
      if (err.response) {
        console.error(
          `[poller] ${asset}: HTTP ${err.response.status} ${err.response.config?.url ?? ''} — ` +
          JSON.stringify(err.response.data).slice(0, 200)
        )
      } else {
        console.error(`[poller] ${asset}:`, err.message)
      }
    }
  }

  return snapshot
}

// Simple RSI calculation from closing prices
function computeRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50

  let gains = 0
  let losses = 0

  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }

  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return 100

  const rs = avgGain / avgLoss
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2))
}
