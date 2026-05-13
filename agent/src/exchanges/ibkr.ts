import axios from 'axios'
import type { AssetSnapshot } from '../schema'
import type { ExchangeAdapter, Portfolio, OrderResult, Decision } from './adapter'
import { computeEMA, computeRSI, computeMACD, computeBollingerBands, computeATR } from './indicators'
import { isPrivateGatewayUrl } from './ibkrUrlValidator'

const REQUEST_TIMEOUT_MS = 10_000

export class IBKRAdapter implements ExchangeAdapter {
  readonly exchange = 'ibkr'
  readonly mode: 'paper' | 'live'
  private gatewayUrl: string
  private sessionToken: string

  constructor(gatewayUrl: string, sessionToken: string, mode: 'paper' | 'live') {
    if (!sessionToken) {
      throw new Error('IBKR gateway not authenticated — start gateway and log in via the browser.')
    }
    // SSRF guard: only allow local/private-network gateway addresses (Fix #2)
    if (!isPrivateGatewayUrl(gatewayUrl)) {
      throw new Error(
        `IBKR gateway URL must point to a local or private-network address (localhost, 127.x, 10.x, 172.16-31.x, 192.168.x, or *.local). Got: ${gatewayUrl}`,
      )
    }
    this.gatewayUrl = gatewayUrl.replace(/\/$/, '')
    this.sessionToken = sessionToken
    this.mode = mode
  }

  private headers() {
    return {
      Cookie: `cp.session=${this.sessionToken}`,
      'Content-Type': 'application/json',
    }
  }

  private async getAccountId(): Promise<string> {
    const res = await axios.get(`${this.gatewayUrl}/v1/api/portfolio/accounts`, {
      headers: this.headers(),
      timeout: REQUEST_TIMEOUT_MS,
    })
    const accounts: any[] = res.data
    if (!accounts?.length) {
      throw new Error('[ibkr] No accounts found on gateway.')
    }
    return accounts[0].accountId as string
  }

  /** Resolve ticker symbol → conid using IBKR's secdef search endpoint. */
  private async resolveConid(symbol: string): Promise<number | null> {
    try {
      const res = await axios.get(`${this.gatewayUrl}/v1/api/iserver/secdef/search`, {
        headers: this.headers(),
        params: { symbol },
        timeout: REQUEST_TIMEOUT_MS,
      })
      const contracts: any[] = res.data
      if (!contracts?.length) return null
      // Prefer STK contracts on primary exchange, otherwise take first
      const stk = contracts.find((c: any) => c.secType === 'STK') || contracts[0]
      return stk.conid as number
    } catch (err: any) {
      console.warn(`[ibkr] resolveConid(${symbol}): ${err.message}`)
      return null
    }
  }

  async fetchPortfolio(): Promise<Portfolio> {
    const accountId = await this.getAccountId()

    const [summaryRes, positionsRes] = await Promise.all([
      axios.get(`${this.gatewayUrl}/v1/api/portfolio/${accountId}/summary`, {
        headers: this.headers(),
        timeout: REQUEST_TIMEOUT_MS,
      }),
      axios.get(`${this.gatewayUrl}/v1/api/portfolio/${accountId}/positions/0`, {
        headers: this.headers(),
        timeout: REQUEST_TIMEOUT_MS,
      }),
    ])

    const summary = summaryRes.data
    const cash_usd = parseFloat(
      summary?.availablefunds?.amount ?? summary?.totalcashvalue?.amount ?? '0'
    )
    const equity_usd = parseFloat(summary?.netliquidation?.amount ?? '0')

    const rawPositions: any[] = positionsRes.data || []
    const positions: Record<string, number> = {}
    const position_details = rawPositions.map((p: any) => {
      const symbol = (p.ticker || p.contractDesc || '').toUpperCase()
      const qty = parseFloat(p.position ?? 0)
      positions[symbol] = qty
      const entryPrice = parseFloat(p.avgCost ?? p.avgPrice ?? 0)
      const currentPrice = parseFloat(p.mktPrice ?? 0)
      const marketValue = parseFloat(p.mktValue ?? 0)
      const unrealizedPL = parseFloat(p.unrealizedPnl ?? 0)
      const unrealizedPLpc = entryPrice > 0 ? (unrealizedPL / (entryPrice * Math.abs(qty))) : 0
      return {
        asset: symbol,
        qty,
        market_value: marketValue,
        unrealized_pl: unrealizedPL,
        unrealized_plpc: parseFloat(unrealizedPLpc.toFixed(4)),
        current_price: currentPrice,
        entry_price: entryPrice,
      }
    })

    return { cash_usd, equity_usd, positions, position_details }
  }

  async fetchMarketSnapshot(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}

    for (const asset of assets) {
      try {
        const symbol = asset.replace(/\/USD$/i, '')
        const conid = await this.resolveConid(symbol)
        if (!conid) {
          console.warn(`[ibkr] ${asset}: could not resolve conid — skipping`)
          continue
        }

        const histRes = await axios.get(`${this.gatewayUrl}/v1/api/iserver/marketdata/history`, {
          headers: this.headers(),
          params: { conid, period: '5d', bar: '1h' },
          timeout: REQUEST_TIMEOUT_MS,
        })

        const rawBars: any[] = histRes.data?.data || []
        if (!rawBars.length) {
          console.warn(`[ibkr] ${asset}: no historical bars returned`)
          continue
        }

        // Normalise IBKR bar format { o, h, l, c, v } (already aligned)
        const bars = rawBars.map((b: any) => ({
          o: parseFloat(b.o),
          h: parseFloat(b.h),
          l: parseFloat(b.l),
          c: parseFloat(b.c),
          v: parseFloat(b.v ?? 0),
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
          // SSRF risk mitigated by URL validation in constructor (see security-review-2026-05-13)
          console.error(
            `[ibkr] ${asset}: HTTP ${err.response.status} ${err.response.config?.url ?? ''} — ` +
            JSON.stringify(err.response.data).slice(0, 200)
          )
        } else {
          console.error(`[ibkr] ${asset}:`, err.message)
        }
      }
    }

    return snapshot
  }

  async fetchLatestPrices(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}

    // Batch-resolve conids first
    const conidMap: Record<string, number> = {}
    await Promise.all(assets.map(async asset => {
      const symbol = asset.replace(/\/USD$/i, '')
      const conid = await this.resolveConid(symbol)
      if (conid) conidMap[asset] = conid
    }))

    const conids = Object.values(conidMap)
    if (!conids.length) return snapshot

    try {
      const res = await axios.get(`${this.gatewayUrl}/v1/api/iserver/marketdata/snapshot`, {
        headers: this.headers(),
        // fields: 31=last price, 84=bid, 86=ask, 7762=volume
        params: { conids: conids.join(','), fields: '31,84,86,7762,70,71' },
        timeout: REQUEST_TIMEOUT_MS,
      })

      const snapshotData: any[] = res.data || []
      // Build a conid→snapshot map
      const conidToData: Record<number, any> = {}
      for (const item of snapshotData) {
        conidToData[item.conid] = item
      }

      for (const [asset, conid] of Object.entries(conidMap)) {
        const item = conidToData[conid]
        if (!item) continue
        const price = parseFloat(item['31'] ?? item['84'] ?? 0)
        if (!price) continue
        snapshot[asset] = {
          price,
          change_24h: 0,
          volume_24h: parseFloat(item['7762'] ?? 0),
          high_24h: parseFloat(item['70'] ?? price),
          low_24h:  parseFloat(item['71'] ?? price),
        }
      }
    } catch (err: any) {
      console.error('[ibkr] fetchLatestPrices snapshot error:', err.message)
    }

    return snapshot
  }

  async executeOrder(decision: Decision): Promise<OrderResult> {
    if (decision.action === 'hold') {
      return { order_id: 'HOLD', status: 'skipped' }
    }

    const symbol = decision.asset.replace(/\/USD$/i, '')
    const conid = await this.resolveConid(symbol)
    if (!conid) {
      return {
        order_id: 'ERROR',
        status: 'rejected',
        reason: `Could not resolve conid for ${decision.asset}`,
      }
    }

    // Get current price to convert USD notional → shares
    const priceSnap = await this.fetchLatestPrices([decision.asset])
    const currentPrice = priceSnap[decision.asset]?.price
    if (!currentPrice || currentPrice <= 0) {
      return {
        order_id: 'ERROR',
        status: 'rejected',
        reason: `Could not determine current price for ${decision.asset}`,
      }
    }

    const shares = Math.floor(decision.amount_usd / currentPrice)
    if (shares < 1) {
      return {
        order_id: 'TOO_SMALL',
        status: 'rejected',
        reason: `Order too small: $${decision.amount_usd} converts to ${shares} shares of ${decision.asset} at $${currentPrice}`,
      }
    }

    const accountId = await this.getAccountId()
    console.log(`[ibkr] Placing ${decision.action} order: ${shares} shares of ${decision.asset} (~$${decision.amount_usd})`)

    const body = {
      orders: [{
        conid,
        side: decision.action === 'buy' ? 'BUY' : 'SELL',
        orderType: 'MKT',
        quantity: shares,
        tif: 'DAY',
      }],
    }

    const res = await axios.post(
      `${this.gatewayUrl}/v1/api/iserver/account/${accountId}/orders`,
      body,
      { headers: this.headers(), timeout: REQUEST_TIMEOUT_MS },
    )

    const data: any[] = res.data
    if (!data?.length) {
      return { order_id: 'UNKNOWN', status: 'unknown' }
    }

    const first = data[0]
    // IBKR may return a "reply" that requires confirmation
    if (first.id && first.message) {
      console.log(`[ibkr] Order requires confirmation (replyId=${first.id}): ${first.message}`)
      try {
        const replyRes = await axios.post(
          `${this.gatewayUrl}/v1/api/iserver/reply/${first.id}`,
          { confirmed: true },
          { headers: this.headers(), timeout: REQUEST_TIMEOUT_MS },
        )
        const confirmed: any[] = replyRes.data
        const confirmedFirst = confirmed?.[0]
        return {
          order_id: confirmedFirst?.orderId?.toString() ?? 'CONFIRMED',
          status:   confirmedFirst?.order_status ?? 'submitted',
        }
      } catch (err: any) {
        console.error('[ibkr] Order confirmation failed:', err.message)
        return { order_id: first.id, status: 'pending_confirmation' }
      }
    }

    return {
      order_id: first.orderId?.toString() ?? first.order_id?.toString() ?? 'SUBMITTED',
      status:   first.order_status ?? 'submitted',
    }
  }
}
