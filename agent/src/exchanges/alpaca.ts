import axios from 'axios'
import type { AssetSnapshot } from '../schema'
import type { ExchangeAdapter, Portfolio, OrderResult, Decision } from './adapter'
import { computeEMA, computeRSI, computeMACD, computeBollingerBands, computeATR } from './indicators'

const DATA_BASE = 'https://data.alpaca.markets'

export class AlpacaAdapter implements ExchangeAdapter {
  readonly exchange = 'alpaca'
  readonly mode: 'paper' | 'live'
  private apiKey: string
  private apiSecret: string
  private baseUrl: string

  constructor(apiKey: string, apiSecret: string, mode: 'paper' | 'live', baseUrl?: string) {
    this.mode = mode
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.baseUrl = baseUrl || (mode === 'live'
      ? 'https://api.alpaca.markets'
      : 'https://paper-api.alpaca.markets')
    console.log(`[alpaca] adapter ready (mode=${mode}, supports crypto + equities via v1beta3/v2)`)
  }

  /** Returns true for crypto symbols (e.g. BTC/USD), false for equities (e.g. MSFT). */
  private isCrypto(symbol: string): boolean {
    return symbol.includes('/')
  }

  /** Returns the feed parameter for equity data requests: iex for paper, sip for live. */
  private equityFeed(): string {
    return this.mode === 'live' ? 'sip' : 'iex'
  }

  private headers() {
    return {
      'APCA-API-KEY-ID': this.apiKey,
      'APCA-API-SECRET-KEY': this.apiSecret,
    }
  }

  async fetchPortfolio(): Promise<Portfolio> {
    const [accountRes, positionsRes] = await Promise.all([
      axios.get(`${this.baseUrl}/v2/account`, { headers: this.headers() }),
      axios.get(`${this.baseUrl}/v2/positions`, { headers: this.headers() }),
    ])

    const positions: Record<string, number> = {}
    for (const p of positionsRes.data) {
      positions[p.symbol] = parseFloat(p.qty)
    }

    const position_details = positionsRes.data.map((p: any) => {
      // For crypto positions Alpaca returns asset_class === 'crypto' and a symbol like BTCUSD.
      // Map those back to the canonical BTC/USD form. Equities keep their symbol as-is.
      const isCryptoAsset = p.asset_class === 'crypto'
      const asset = isCryptoAsset
        ? p.symbol.replace(/([A-Z]+)(USD)$/, '$1/$2')
        : p.symbol
      return {
        asset,
        qty: parseFloat(p.qty),
        market_value: parseFloat(p.market_value),
        unrealized_pl: parseFloat(p.unrealized_pl),
        unrealized_plpc: parseFloat(p.unrealized_plpc),
        current_price: parseFloat(p.current_price),
        entry_price: parseFloat(p.avg_entry_price),
      }
    })

    return {
      cash_usd: parseFloat(accountRes.data.cash),
      equity_usd: parseFloat(accountRes.data.equity),
      positions,
      position_details,
    }
  }

  async fetchMarketSnapshot(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}

    for (const asset of assets) {
      try {
        // Explicit start timestamps — Alpaca ignores `limit` alone without a time range
        const hourlyStart = new Date(Date.now() - 110 * 60 * 60 * 1000).toISOString() // 110h ago → 100+ bars
        const dailyStart  = new Date(Date.now() -  65 * 24 * 60 * 60 * 1000).toISOString() // 65d ago → 60+ bars

        let barRes: any, dailyRes: any

        if (this.isCrypto(asset)) {
          // ── Crypto path: /v1beta3/crypto/us/bars ──
          ;[barRes, dailyRes] = await Promise.all([
            axios.get(`${DATA_BASE}/v1beta3/crypto/us/bars`, {
              headers: this.headers(),
              params: { symbols: asset, timeframe: '1H', start: hourlyStart, limit: 100 },
            }),
            axios.get(`${DATA_BASE}/v1beta3/crypto/us/bars`, {
              headers: this.headers(),
              params: { symbols: asset, timeframe: '1D', start: dailyStart, limit: 60 },
            }),
          ])
        } else {
          // ── Equity path: /v2/stocks/bars ──
          // feed=iex on paper (free tier); feed=sip on live (requires paid subscription)
          const feed = this.equityFeed()
          ;[barRes, dailyRes] = await Promise.all([
            axios.get(`${DATA_BASE}/v2/stocks/bars`, {
              headers: this.headers(),
              params: { symbols: asset, timeframe: '1H', start: hourlyStart, limit: 100, feed },
            }),
            axios.get(`${DATA_BASE}/v2/stocks/bars`, {
              headers: this.headers(),
              params: { symbols: asset, timeframe: '1D', start: dailyStart, limit: 60, feed },
            }),
          ])
        }

        const bars: any[] = barRes.data.bars[asset] || []
        const dailyBars: any[] = dailyRes.data.bars[asset] || []

        if (!bars.length) {
          console.warn(`[alpaca] ${asset}: no hourly bars returned — asset may not be available on Alpaca US`)
          continue
        }
        if (bars.length < 15) {
          console.warn(`[alpaca] ${asset}: only ${bars.length} hourly bars returned (need 15+ for RSI, 26+ for MACD)`)
        } else {
          console.log(`[alpaca] ${asset}: ${bars.length} hourly bars, ${dailyBars.length} daily bars`)
        }

        const latest = bars[bars.length - 1]
        const prev24h = bars.length >= 24 ? bars[bars.length - 24] : bars[0]
        const closes = bars.map((b: any) => b.c)

        // — Hourly indicators —
        const rsi        = computeRSI(closes, 14)
        const ema9arr    = computeEMA(closes, 9)
        const ema21arr   = computeEMA(closes, 21)
        const macdData   = computeMACD(closes)
        const bb         = computeBollingerBands(closes)
        const atr        = computeATR(bars)
        const volSma20   = bars.length >= 20
          ? parseFloat((bars.slice(-20).reduce((s: number, b: any) => s + b.v, 0) / 20).toFixed(0))
          : undefined

        // — Daily indicators —
        let change_7d: number | undefined
        let daily_sma50: number | undefined
        if (dailyBars.length >= 7) {
          const d   = dailyBars[dailyBars.length - 1]
          const d7  = dailyBars[dailyBars.length - 7]
          change_7d = parseFloat((((d.c - d7.o) / d7.o) * 100).toFixed(2))
        }
        if (dailyBars.length >= 50) {
          const sma50slice = dailyBars.slice(-50).map((b: any) => b.c)
          daily_sma50 = parseFloat((sma50slice.reduce((a: number, b: number) => a + b, 0) / 50).toFixed(6))
        }

        snapshot[asset] = {
          price:        latest.c,
          change_24h:   parseFloat((((latest.c - prev24h.o) / prev24h.o) * 100).toFixed(2)),
          change_7d,
          volume_24h:   bars.slice(-24).reduce((s: number, b: any) => s + b.v, 0),
          volume_sma20: volSma20,
          high_24h:     Math.max(...bars.slice(-24).map((b: any) => b.h)),
          low_24h:      Math.min(...bars.slice(-24).map((b: any) => b.l)),
          rsi_14:       rsi,
          ema_9:        ema9arr.length  ? parseFloat(ema9arr[ema9arr.length - 1].toFixed(6))   : undefined,
          ema_21:       ema21arr.length ? parseFloat(ema21arr[ema21arr.length - 1].toFixed(6)) : undefined,
          macd:         macdData?.macd,
          macd_signal:  macdData?.signal,
          macd_hist:    macdData?.hist,
          bb_upper:     bb?.upper,
          bb_lower:     bb?.lower,
          bb_pct:       bb?.pct,
          atr_14:       atr ?? undefined,
          daily_sma50,
        }
      } catch (err: any) {
        if (err.response) {
          console.error(
            `[alpaca] ${asset}: HTTP ${err.response.status} ${err.response.config?.url ?? ''} — ` +
            JSON.stringify(err.response.data).slice(0, 200)
          )
        } else {
          console.error(`[alpaca] ${asset}:`, err.message)
        }
      }
    }

    return snapshot
  }

  async fetchLatestPrices(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}

    const cryptoAssets  = assets.filter(a => this.isCrypto(a))
    const equityAssets  = assets.filter(a => !this.isCrypto(a))

    // ── Crypto latest bars (batched) ──
    for (const asset of cryptoAssets) {
      try {
        const res = await axios.get(`${DATA_BASE}/v1beta3/crypto/us/latest/bars`, {
          headers: this.headers(),
          params: { symbols: asset },
        })
        const bar = res.data.bars?.[asset]
        if (!bar) continue
        snapshot[asset] = {
          price: bar.c,
          change_24h: 0,
          volume_24h: bar.v,
          high_24h: bar.h,
          low_24h: bar.l,
        }
      } catch { /* ignore */ }
    }

    // ── Equity latest bars: /v2/stocks/bars/latest?symbols=A,B,C&feed=iex|sip ──
    if (equityAssets.length > 0) {
      try {
        const feed = this.equityFeed()
        const res = await axios.get(`${DATA_BASE}/v2/stocks/bars/latest`, {
          headers: this.headers(),
          params: { symbols: equityAssets.join(','), feed },
        })
        const bars = res.data.bars ?? {}
        for (const asset of equityAssets) {
          const bar = bars[asset]
          if (!bar) continue
          snapshot[asset] = {
            price: bar.c,
            change_24h: 0,
            volume_24h: bar.v,
            high_24h: bar.h,
            low_24h: bar.l,
          }
        }
      } catch { /* ignore */ }
    }

    return snapshot
  }

  async executeOrder(decision: Decision): Promise<OrderResult> {
    if (decision.action === 'hold') {
      return { order_id: 'HOLD', status: 'skipped' }
    }

    let body: Record<string, string>

    if (this.isCrypto(decision.asset)) {
      // Crypto: symbol must be BTCUSD (no slash), time_in_force=gtc
      body = {
        symbol: decision.asset.replace('/', ''),  // BTC/USD → BTCUSD
        notional: decision.amount_usd.toFixed(2),
        side: decision.action,
        type: 'market',
        time_in_force: 'gtc',
      }
    } else {
      // Equity: symbol stays as-is (MSFT, SPY, AAPL), time_in_force=day
      // notional (dollar amount) works for fractional shares on paper accounts
      body = {
        symbol: decision.asset,
        notional: decision.amount_usd.toFixed(2),
        side: decision.action,
        type: 'market',
        time_in_force: 'day',
      }
    }

    console.log(`[alpaca] Placing ${decision.action} order: $${decision.amount_usd} of ${decision.asset}`)

    const res = await axios.post(`${this.baseUrl}/v2/orders`, body, {
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
    })

    return {
      order_id: res.data.id,
      status: res.data.status,
      filled_at: res.data.filled_at,
      filled_avg_price: res.data.filled_avg_price
        ? parseFloat(res.data.filled_avg_price)
        : undefined,
    }
  }
}

