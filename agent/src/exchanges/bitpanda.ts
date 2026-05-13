// TODO: Bitpanda stocks/ETFs via the Bitpanda Fusion API are NOT yet supported.
//       This adapter covers crypto-only trading via the Bitpanda Pro REST API.
//       When Bitpanda exposes a stable stocks endpoint, add a second adapter class
//       (BitpandaStocksAdapter) or extend this one with a `type: 'crypto' | 'stock'`
//       constructor option.

import axios from 'axios'
import type { AssetSnapshot } from '../schema'
import type { ExchangeAdapter, Portfolio, OrderResult, Decision } from './adapter'
import { computeEMA, computeRSI, computeMACD, computeBollingerBands, computeATR } from './indicators'

const BASE_URL = 'https://api.exchange.bitpanda.com/public/v1'
const REQUEST_TIMEOUT_MS = 10_000

/**
 * Map common "BTC/USD" style pairs to Bitpanda Pro instrument codes.
 * Bitpanda Pro is EUR-denominated for EU users; USD pairs are not always available.
 * Users can also pass Bitpanda-native instrument codes directly (e.g. "BTC_EUR").
 */
function toBitpandaInstrument(asset: string): string {
  // If already Bitpanda-style (underscore separator), return as-is
  if (asset.includes('_')) return asset
  // Otherwise treat "BTC/USD" → "BTC_EUR" (EUR base for EU users)
  const [base, quote] = asset.split('/')
  if (!base) return asset
  const mappedQuote = (quote || 'EUR') === 'USD' ? 'EUR' : (quote || 'EUR')
  return `${base}_${mappedQuote}`
}

/** Minimum order amounts per crypto (approximate; real values differ per pair). */
const MIN_LOT_FALLBACK = 0.0001

export class BitpandaAdapter implements ExchangeAdapter {
  readonly exchange = 'bitpanda'
  readonly mode: 'paper' | 'live'
  private apiKey: string
  private apiSecret: string

  constructor(apiKey: string, apiSecret: string, mode: 'paper' | 'live') {
    if (mode === 'paper') {
      throw new Error(
        'Bitpanda paper trading is not supported — create a paper Alpaca wallet instead.'
      )
    }
    if (!apiKey) {
      throw new Error('Bitpanda API key is required.')
    }
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.mode = mode
  }

  private authHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  /**
   * Fetch the latest ticker price for a Bitpanda instrument.
   * Returns null if unavailable (non-fatal).
   */
  private async getTickerPrice(instrument: string): Promise<number | null> {
    try {
      const res = await axios.get(`${BASE_URL}/market-ticker/${instrument}`, {
        headers: this.authHeaders(),
        timeout: REQUEST_TIMEOUT_MS,
      })
      const price = parseFloat(res.data?.last_price ?? res.data?.best_ask ?? '0')
      return price > 0 ? price : null
    } catch (err: any) {
      console.warn(`[bitpanda] getTickerPrice(${instrument}): ${err.message}`)
      return null
    }
  }

  async fetchPortfolio(): Promise<Portfolio> {
    const res = await axios.get(`${BASE_URL}/account/balances`, {
      headers: this.authHeaders(),
      timeout: REQUEST_TIMEOUT_MS,
    })

    const balances: any[] = res.data?.balances ?? []
    let cash_usd = 0
    let equity_usd = 0
    const positions: Record<string, number> = {}
    const position_details = []

    for (const b of balances) {
      const currency: string = (b.currency_code || '').toUpperCase()
      const available = parseFloat(b.available ?? '0')
      const locked    = parseFloat(b.locked ?? '0')
      const total     = available + locked

      if (total <= 0) continue

      if (currency === 'EUR') {
        // Convert EUR balance to approximate USD (1 EUR ≈ 1.08 USD — rough; no FX API used)
        cash_usd += total * 1.08
        continue
      }
      if (currency === 'USD' || currency === 'USDT' || currency === 'USDC') {
        cash_usd += total
        continue
      }

      // Crypto balance — try to price it
      const instrument = `${currency}_EUR`
      const eurPrice = await this.getTickerPrice(instrument)
      if (eurPrice) {
        const marketValue = total * eurPrice * 1.08  // rough EUR→USD
        equity_usd += marketValue
        const assetKey = `${currency}/USD`
        positions[assetKey] = total
        position_details.push({
          asset: assetKey,
          qty: total,
          market_value: parseFloat(marketValue.toFixed(2)),
          unrealized_pl: 0,   // Bitpanda Pro doesn't expose unrealised P&L via balances
          unrealized_plpc: 0,
          current_price: parseFloat((eurPrice * 1.08).toFixed(6)),
          entry_price: 0,     // not available from balances endpoint
        })
      } else {
        positions[`${currency}/USD`] = total
      }
    }

    return { cash_usd, equity_usd, positions, position_details }
  }

  async fetchMarketSnapshot(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}

    for (const asset of assets) {
      try {
        const instrument = toBitpandaInstrument(asset)

        // Fetch ~110 1-hour candles for indicator warmup
        const to   = new Date()
        const from = new Date(to.getTime() - 110 * 60 * 60 * 1000)

        const candleRes = await axios.get(`${BASE_URL}/candlesticks/${instrument}`, {
          headers: this.authHeaders(),
          params: {
            unit: 'HOURS',
            period: 1,
            from: from.toISOString(),
            to: to.toISOString(),
          },
          timeout: REQUEST_TIMEOUT_MS,
        })

        const rawCandles: any[] = candleRes.data || []
        if (!rawCandles.length) {
          console.warn(`[bitpanda] ${asset}: no candles returned for ${instrument}`)
          continue
        }

        // Bitpanda candlestick format:
        // { time, open, high, low, close, volume, instrument_code }
        const bars = rawCandles.map((c: any) => ({
          o: parseFloat(c.open),
          h: parseFloat(c.high),
          l: parseFloat(c.low),
          c: parseFloat(c.close),
          v: parseFloat(c.volume ?? '0'),
        }))

        const closes = bars.map(b => b.c)
        const latest = bars[bars.length - 1]
        const prev24hBar = bars.length >= 24 ? bars[bars.length - 24] : bars[0]

        const rsi       = computeRSI(closes, 14)
        const ema9arr   = computeEMA(closes, 9)
        const ema21arr  = computeEMA(closes, 21)
        const macdData  = computeMACD(closes)
        const bb        = computeBollingerBands(closes)
        const atr       = computeATR(bars)
        const volSma20  = bars.length >= 20
          ? parseFloat((bars.slice(-20).reduce((s, b) => s + b.v, 0) / 20).toFixed(0))
          : undefined

        snapshot[asset] = {
          price:        latest.c,
          change_24h:   parseFloat((((latest.c - prev24hBar.o) / prev24hBar.o) * 100).toFixed(2)),
          volume_24h:   bars.slice(-24).reduce((s, b) => s + b.v, 0),
          volume_sma20: volSma20,
          high_24h:     Math.max(...bars.slice(-24).map(b => b.h)),
          low_24h:      Math.min(...bars.slice(-24).map(b => b.l)),
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
        }
      } catch (err: any) {
        if (err.response) {
          // SSRF risk mitigated by URL validation in createUserWallet (see security-review-2026-05-13)
          console.error(
            `[bitpanda] ${asset}: HTTP ${err.response.status} ${err.response.config?.url ?? ''} — ` +
            JSON.stringify(err.response.data).slice(0, 200)
          )
        } else {
          console.error(`[bitpanda] ${asset}:`, err.message)
        }
      }
    }

    return snapshot
  }

  async fetchLatestPrices(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}

    for (const asset of assets) {
      try {
        const instrument = toBitpandaInstrument(asset)
        const res = await axios.get(`${BASE_URL}/market-ticker/${instrument}`, {
          headers: this.authHeaders(),
          timeout: REQUEST_TIMEOUT_MS,
        })
        const ticker = res.data
        if (!ticker) continue
        const price = parseFloat(ticker.last_price ?? ticker.best_ask ?? '0')
        if (!price) continue
        snapshot[asset] = {
          price,
          change_24h: parseFloat(ticker.price_change_24h ?? '0'),
          volume_24h: parseFloat(ticker.base_volume ?? '0'),
          high_24h:   parseFloat(ticker.high ?? price.toString()),
          low_24h:    parseFloat(ticker.low ?? price.toString()),
        }
      } catch { /* ignore individual asset errors */ }
    }

    return snapshot
  }

  async executeOrder(decision: Decision): Promise<OrderResult> {
    if (decision.action === 'hold') {
      return { order_id: 'HOLD', status: 'skipped' }
    }

    const instrument = toBitpandaInstrument(decision.asset)

    // Get current price to convert USD notional → crypto qty
    const priceSnap = await this.fetchLatestPrices([decision.asset])
    const currentPrice = priceSnap[decision.asset]?.price
    if (!currentPrice || currentPrice <= 0) {
      return {
        order_id: 'ERROR',
        status: 'rejected',
        reason: `Could not determine current price for ${decision.asset}`,
      }
    }

    const cryptoQty = Math.max(
      decision.amount_usd / currentPrice,
      MIN_LOT_FALLBACK,
    )
    if (cryptoQty < MIN_LOT_FALLBACK) {
      return {
        order_id: 'TOO_SMALL',
        status: 'rejected',
        reason: `Order too small: $${decision.amount_usd} converts to ${cryptoQty} of ${decision.asset}`,
      }
    }

    console.log(`[bitpanda] Placing ${decision.action} order: ${cryptoQty} of ${decision.asset} (~$${decision.amount_usd})`)

    const body: Record<string, unknown> = {
      instrument_code: instrument,
      side: decision.action === 'buy' ? 'BUY' : 'SELL',
      type: 'MARKET',
      amount: cryptoQty.toFixed(8),
    }

    // apiSecret is used for HMAC signing if Bitpanda Pro requires it in future.
    // Currently the Bearer-token auth is sufficient for order submission.
    // Stored in this.apiSecret for forward-compatibility.

    const res = await axios.post(`${BASE_URL}/account/orders`, body, {
      headers: this.authHeaders(),
      timeout: REQUEST_TIMEOUT_MS,
    })

    const order = res.data
    return {
      order_id: order?.order_id ?? order?.id ?? 'SUBMITTED',
      status:   order?.status ?? 'submitted',
      filled_avg_price: order?.avg_price ? parseFloat(order.avg_price) : undefined,
    }
  }
}
