# Trading Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add rate limiting, paper/live mode toggle, multi-exchange support (Binance + Coinbase), weekly/monthly P&L, and portfolio allocation UI to TradingAgentCore.

**Architecture:** Extract an `ExchangeAdapter` interface into `agent/src/exchanges/`; migrate Alpaca logic there and add Binance/Coinbase adapters. The engine resolves the adapter from the active wallet each cycle. Rate limiting is applied in `api.ts`. P&L period grouping is a new MongoDB aggregation endpoint. The AllocationCard is a new React component consuming existing API data.

**Tech Stack:** Node.js 20 + TypeScript 5, Express 4, MongoDB/Mongoose 9, React 18, Recharts 2, `express-rate-limit`, `jsonwebtoken` (already installed), Node.js built-in `crypto` (HMAC for Binance)

---

## File Map

**New files:**
- `agent/src/exchanges/adapter.ts` — `ExchangeAdapter` interface + shared types (`Portfolio`, `PositionDetail`, `OrderResult`, `Bar`)
- `agent/src/exchanges/alpaca.ts` — `AlpacaAdapter` class (migrated from poller.ts / executor.ts)
- `agent/src/exchanges/binance.ts` — `BinanceAdapter` class
- `agent/src/exchanges/coinbase.ts` — `CoinbaseAdapter` class
- `agent/src/exchanges/index.ts` — `createAdapter(wallet): ExchangeAdapter` factory
- `dashboard/src/components/AllocationCard.tsx` — allocation bar + table

**Modified files:**
- `agent/package.json` — add `express-rate-limit`, `@types/express-rate-limit`
- `agent/src/schema.ts` — add `exchange`, `mode`, Binance/Coinbase credential fields to `WalletDoc`
- `agent/src/keys.ts` — update `UserWalletInfo`, `listUserWallets`, `createUserWallet` for new fields; add `getAdapterForUser(userId)`
- `agent/src/risk.ts` — replace `AlpacaCredentials` param with `ExchangeAdapter` in `monitorStopLossTakeProfit` and `updateAndCheckTrailingStops`
- `agent/src/engineManager.ts` — resolve adapter per cycle; remove direct poller/executor imports
- `agent/src/api.ts` — auth rate limiters; update `/api/positions`; add `POST /api/wallets/:id/mode`; update wallet CRUD for new fields; add `GET /api/stats/per-period`
- `dashboard/src/pages/Overview.tsx` — live mode banner, P&L period toggle, AllocationCard
- `dashboard/src/pages/Settings.tsx` — exchange selector + mode in wallet creation form
- `dashboard/src/api.ts` — add `setWalletMode`, `getStatsPerPeriod`

---

## Task 1: Install dependencies

**Files:**
- Modify: `agent/package.json`

- [ ] **Step 1: Install rate-limit and types**

```bash
cd agent
npm install express-rate-limit
npm install --save-dev @types/express-rate-limit
```

Expected output: `added N packages`

- [ ] **Step 2: Verify install**

```bash
node -e "require('express-rate-limit'); console.log('ok')"
```

Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add agent/package.json agent/package-lock.json
git commit -m "chore: add express-rate-limit dependency"
```

---

## Task 2: Rate limiting on auth endpoints

**Files:**
- Modify: `agent/src/api.ts` (top of file, before route definitions)

- [ ] **Step 1: Add rate limiter imports and definitions**

In `agent/src/api.ts`, after the existing imports (around line 10), add:

```typescript
import rateLimit from 'express-rate-limit'

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, please try again later.' },
})

const twoFaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many 2FA attempts, please try again later.' },
})

const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many registration attempts, please try again later.' },
})
```

- [ ] **Step 2: Apply limiters to auth routes**

Find `app.post('/api/auth/login'` and add `loginLimiter` as middleware:

```typescript
app.post('/api/auth/login', loginLimiter, async (req, res) => {
```

Find `app.post('/api/auth/login/2fa'` and add `twoFaLimiter`:

```typescript
app.post('/api/auth/login/2fa', twoFaLimiter, async (req, res) => {
```

Find `app.post('/api/auth/register'` and add `registerLimiter`:

```typescript
app.post('/api/auth/register', registerLimiter, async (req, res) => {
```

- [ ] **Step 3: Build to verify no TypeScript errors**

```bash
cd agent && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add agent/src/api.ts
git commit -m "feat: add rate limiting to auth endpoints (5/login, 10/2fa, 3/register)"
```

---

## Task 3: Wallet schema — exchange + mode + exchange-specific credentials

**Files:**
- Modify: `agent/src/schema.ts` (WalletDoc interface + WalletSchema)

- [ ] **Step 1: Update WalletDoc interface**

Replace the existing `WalletDoc` interface (lines 221–230) with:

```typescript
export interface WalletDoc extends Document {
  userId: string
  name: string
  active: boolean
  exchange: 'alpaca' | 'binance' | 'coinbase'
  mode: 'paper' | 'live'
  // Alpaca credentials
  alpaca_api_key: string
  alpaca_api_secret: string
  alpaca_base_url: string
  // Binance credentials
  binance_api_key: string
  binance_api_secret: string
  // Coinbase credentials
  coinbase_api_key: string
  coinbase_api_secret: string
  createdAt: Date
  updatedAt: Date
}
```

- [ ] **Step 2: Update WalletSchema**

Replace the existing `WalletSchema` definition with:

```typescript
const WalletSchema = new Schema<WalletDoc>({
  userId: { type: String, required: true, index: true },
  name: { type: String, required: true },
  active: { type: Boolean, default: false, index: true },
  exchange: { type: String, enum: ['alpaca', 'binance', 'coinbase'], default: 'alpaca' },
  mode: { type: String, enum: ['paper', 'live'], default: 'paper' },
  alpaca_api_key: { type: String, default: '' },
  alpaca_api_secret: { type: String, default: '' },
  alpaca_base_url: { type: String, default: 'https://paper-api.alpaca.markets' },
  binance_api_key: { type: String, default: '' },
  binance_api_secret: { type: String, default: '' },
  coinbase_api_key: { type: String, default: '' },
  coinbase_api_secret: { type: String, default: '' },
}, { timestamps: true })

WalletSchema.index({ userId: 1, name: 1 }, { unique: true })
WalletSchema.index({ userId: 1, active: 1 })
```

- [ ] **Step 3: Build to verify**

```bash
cd agent && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add agent/src/schema.ts
git commit -m "feat: add exchange, mode, and credential fields to WalletSchema"
```

---

## Task 4: Exchange adapter interface

**Files:**
- Create: `agent/src/exchanges/adapter.ts`

- [ ] **Step 1: Create the exchanges directory and adapter interface**

```bash
mkdir -p agent/src/exchanges
```

Create `agent/src/exchanges/adapter.ts`:

```typescript
import type { AssetSnapshot } from '../schema'

// Normalized position with full detail (for /api/positions endpoint)
export interface PositionDetail {
  asset: string          // normalized: 'BTC/USD'
  qty: number
  market_value: number
  unrealized_pl: number
  unrealized_plpc: number
  current_price: number
  entry_price: number
}

// Portfolio returned by all adapters
export interface Portfolio {
  cash_usd: number
  equity_usd: number
  positions: Record<string, number>   // asset → qty (used by engine)
  position_details: PositionDetail[]  // used by /api/positions
}

export interface OrderResult {
  order_id: string
  status: string
  filled_at?: string
  filled_avg_price?: number
}

export interface Bar {
  t: string   // ISO timestamp
  o: number
  h: number
  l: number
  c: number
  v: number
}

export interface Decision {
  action: 'buy' | 'sell' | 'hold'
  asset: string
  amount_usd: number
  confidence: number
  reasoning: string
}

export interface ExchangeAdapter {
  readonly exchange: string
  readonly mode: 'paper' | 'live'
  fetchPortfolio(): Promise<Portfolio>
  fetchMarketSnapshot(assets: string[]): Promise<Record<string, AssetSnapshot>>
  fetchLatestPrices(assets: string[]): Promise<Record<string, AssetSnapshot>>
  executeOrder(decision: Decision): Promise<OrderResult>
}
```

- [ ] **Step 2: Build to verify**

```bash
cd agent && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add agent/src/exchanges/adapter.ts
git commit -m "feat: add ExchangeAdapter interface with Portfolio, PositionDetail, OrderResult types"
```

---

## Task 5: Alpaca adapter

**Files:**
- Create: `agent/src/exchanges/alpaca.ts`

- [ ] **Step 1: Create the AlpacaAdapter, migrating logic from poller.ts and executor.ts**

Create `agent/src/exchanges/alpaca.ts`:

```typescript
import axios from 'axios'
import type { AssetSnapshot } from '../schema'
import type { ExchangeAdapter, Portfolio, OrderResult, Decision } from './adapter'

const DATA_BASE = 'https://data.alpaca.markets'

interface AlpacaCreds {
  apiKey: string
  apiSecret: string
  baseUrl: string
}

export class AlpacaAdapter implements ExchangeAdapter {
  readonly exchange = 'alpaca'
  readonly mode: 'paper' | 'live'
  private creds: AlpacaCreds

  constructor(apiKey: string, apiSecret: string, mode: 'paper' | 'live', baseUrl?: string) {
    this.mode = mode
    this.creds = {
      apiKey,
      apiSecret,
      baseUrl: baseUrl || (mode === 'live'
        ? 'https://api.alpaca.markets'
        : 'https://paper-api.alpaca.markets'),
    }
  }

  private headers() {
    return {
      'APCA-API-KEY-ID': this.creds.apiKey,
      'APCA-API-SECRET-KEY': this.creds.apiSecret,
    }
  }

  async fetchPortfolio(): Promise<Portfolio> {
    const [accountRes, positionsRes] = await Promise.all([
      axios.get(`${this.creds.baseUrl}/v2/account`, { headers: this.headers() }),
      axios.get(`${this.creds.baseUrl}/v2/positions`, { headers: this.headers() }),
    ])

    const positions: Record<string, number> = {}
    const position_details = positionsRes.data.map((p: any) => {
      const asset = p.symbol.replace(/([A-Z]+)(USD)$/, '$1/$2')  // BTCUSD → BTC/USD
      const qty = parseFloat(p.qty)
      positions[asset] = qty
      return {
        asset,
        qty,
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
        const hourlyStart = new Date(Date.now() - 110 * 60 * 60 * 1000).toISOString()
        const dailyStart = new Date(Date.now() - 65 * 24 * 60 * 60 * 1000).toISOString()
        const [barRes, dailyRes] = await Promise.all([
          axios.get(`${DATA_BASE}/v1beta3/crypto/us/bars`, {
            headers: this.headers(),
            params: { symbols: asset, timeframe: '1H', start: hourlyStart, limit: 100 },
          }),
          axios.get(`${DATA_BASE}/v1beta3/crypto/us/bars`, {
            headers: this.headers(),
            params: { symbols: asset, timeframe: '1D', start: dailyStart, limit: 60 },
          }),
        ])
        const bars: any[] = barRes.data.bars[asset] || []
        const dailyBars: any[] = dailyRes.data.bars[asset] || []
        if (!bars.length) continue
        const latest = bars[bars.length - 1]
        const prev24h = bars.length >= 24 ? bars[bars.length - 24] : bars[0]
        const closes = bars.map((b: any) => b.c)
        const rsi = computeRSI(closes, 14)
        const ema9arr = computeEMA(closes, 9)
        const ema21arr = computeEMA(closes, 21)
        const macdData = computeMACD(closes)
        const bb = computeBollingerBands(closes)
        const atr = computeATR(bars)
        const volSma20 = bars.length >= 20
          ? parseFloat((bars.slice(-20).reduce((s: number, b: any) => s + b.v, 0) / 20).toFixed(0))
          : undefined
        let change_7d: number | undefined
        let daily_sma50: number | undefined
        if (dailyBars.length >= 7) {
          const d = dailyBars[dailyBars.length - 1]
          const d7 = dailyBars[dailyBars.length - 7]
          change_7d = parseFloat((((d.c - d7.o) / d7.o) * 100).toFixed(2))
        }
        if (dailyBars.length >= 50) {
          const sma50slice = dailyBars.slice(-50).map((b: any) => b.c)
          daily_sma50 = parseFloat((sma50slice.reduce((a: number, b: number) => a + b, 0) / 50).toFixed(6))
        }
        snapshot[asset] = {
          price: latest.c,
          change_24h: parseFloat((((latest.c - prev24h.o) / prev24h.o) * 100).toFixed(2)),
          change_7d,
          volume_24h: bars.slice(-24).reduce((s: number, b: any) => s + b.v, 0),
          volume_sma20: volSma20,
          high_24h: Math.max(...bars.slice(-24).map((b: any) => b.h)),
          low_24h: Math.min(...bars.slice(-24).map((b: any) => b.l)),
          rsi_14: rsi,
          ema_9: ema9arr.length ? parseFloat(ema9arr[ema9arr.length - 1].toFixed(6)) : undefined,
          ema_21: ema21arr.length ? parseFloat(ema21arr[ema21arr.length - 1].toFixed(6)) : undefined,
          macd: macdData?.macd,
          macd_signal: macdData?.signal,
          macd_hist: macdData?.hist,
          bb_upper: bb?.upper,
          bb_lower: bb?.lower,
          bb_pct: bb?.pct,
          atr_14: atr ?? undefined,
          daily_sma50,
        }
      } catch (err: any) {
        console.error(`[alpaca] ${asset}:`, err.message)
      }
    }
    return snapshot
  }

  async fetchLatestPrices(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}
    for (const asset of assets) {
      try {
        const res = await axios.get(`${DATA_BASE}/v1beta3/crypto/us/latest/bars`, {
          headers: this.headers(),
          params: { symbols: asset },
        })
        const bar = res.data.bars?.[asset]
        if (!bar) continue
        snapshot[asset] = { price: bar.c, change_24h: 0, volume_24h: bar.v, high_24h: bar.h, low_24h: bar.l }
      } catch { /* ignore */ }
    }
    return snapshot
  }

  async executeOrder(decision: Decision): Promise<OrderResult> {
    if (decision.action === 'hold') return { order_id: 'HOLD', status: 'skipped' }
    const body = {
      symbol: decision.asset.replace('/', ''),
      notional: decision.amount_usd.toFixed(2),
      side: decision.action,
      type: 'market',
      time_in_force: 'gtc',
    }
    console.log(`[alpaca] Placing ${decision.action} $${decision.amount_usd} of ${decision.asset}`)
    const res = await axios.post(`${this.creds.baseUrl}/v2/orders`, body, {
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
    })
    return {
      order_id: res.data.id,
      status: res.data.status,
      filled_at: res.data.filled_at,
      filled_avg_price: res.data.filled_avg_price ? parseFloat(res.data.filled_avg_price) : undefined,
    }
  }
}

// ─── Indicator helpers (copied from poller.ts, kept DRY via this single location) ─
function computeEMA(values: number[], period: number): number[] {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  const result = [ema]
  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k)
    result.push(ema)
  }
  return result
}

function computeRSI(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  const rs = (gains / period) / avgLoss
  return parseFloat((100 - 100 / (1 + rs)).toFixed(2))
}

function computeMACD(closes: number[]): { macd: number; signal: number; hist: number } | null {
  const ema12 = computeEMA(closes, 12)
  const ema26 = computeEMA(closes, 26)
  if (!ema12.length || !ema26.length) return null
  const offset = ema12.length - ema26.length
  const macdLine = ema26.map((v, i) => ema12[i + offset] - v)
  const signalLine = computeEMA(macdLine, 9)
  if (!signalLine.length) return null
  const lastMacd = macdLine[macdLine.length - 1]
  const lastSignal = signalLine[signalLine.length - 1]
  return {
    macd: parseFloat(lastMacd.toFixed(6)),
    signal: parseFloat(lastSignal.toFixed(6)),
    hist: parseFloat((lastMacd - lastSignal).toFixed(6)),
  }
}

function computeBollingerBands(closes: number[], period = 20): { upper: number; lower: number; pct: number } | null {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  const sma = slice.reduce((a, b) => a + b, 0) / period
  const sd = Math.sqrt(slice.reduce((a, b) => a + Math.pow(b - sma, 2), 0) / period)
  const upper = sma + 2 * sd, lower = sma - 2 * sd
  const pct = upper === lower ? 0.5 : (closes[closes.length - 1] - lower) / (upper - lower)
  return { upper: parseFloat(upper.toFixed(6)), lower: parseFloat(lower.toFixed(6)), pct: parseFloat(pct.toFixed(3)) }
}

function computeATR(bars: any[], period = 14): number | null {
  if (bars.length < period + 1) return null
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)))
  const atrArr = computeEMA(tr, period)
  return atrArr.length ? parseFloat(atrArr[atrArr.length - 1].toFixed(6)) : null
}
```

- [ ] **Step 2: Build**

```bash
cd agent && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add agent/src/exchanges/alpaca.ts
git commit -m "feat: add AlpacaAdapter migrating logic from poller.ts and executor.ts"
```

---

## Task 6: Binance adapter

**Files:**
- Create: `agent/src/exchanges/binance.ts`

- [ ] **Step 1: Create BinanceAdapter**

Create `agent/src/exchanges/binance.ts`:

```typescript
import axios from 'axios'
import crypto from 'crypto'
import type { AssetSnapshot } from '../schema'
import type { ExchangeAdapter, Portfolio, OrderResult, Decision } from './adapter'

const LIVE_BASE = 'https://api.binance.com'
const PAPER_BASE = 'https://testnet.binance.vision'

// Normalize 'BTC/USD' → 'BTCUSDT', 'ETH/USD' → 'ETHUSDT'
function toSymbol(asset: string): string {
  return asset.replace('/', '').replace('USD', 'USDT')
}
// Normalize 'BTCUSDT' → 'BTC/USD'
function fromSymbol(sym: string): string {
  return sym.replace('USDT', '/USD')
}

export class BinanceAdapter implements ExchangeAdapter {
  readonly exchange = 'binance'
  readonly mode: 'paper' | 'live'
  private apiKey: string
  private apiSecret: string
  private base: string

  constructor(apiKey: string, apiSecret: string, mode: 'paper' | 'live') {
    this.mode = mode
    this.apiKey = apiKey
    this.apiSecret = apiSecret
    this.base = mode === 'live' ? LIVE_BASE : PAPER_BASE
  }

  private headers() {
    return { 'X-MBX-APIKEY': this.apiKey }
  }

  private sign(params: Record<string, any>): string {
    const qs = new URLSearchParams({ ...params, timestamp: Date.now().toString() }).toString()
    const sig = crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex')
    return `${qs}&signature=${sig}`
  }

  async fetchPortfolio(): Promise<Portfolio> {
    const res = await axios.get(`${this.base}/api/v3/account?${this.sign({})}`, {
      headers: this.headers(),
    })
    const balances: Array<{ asset: string; free: string; locked: string }> = res.data.balances
    const usdtBalance = balances.find(b => b.asset === 'USDT')
    const cash_usd = parseFloat(usdtBalance?.free || '0') + parseFloat(usdtBalance?.locked || '0')

    const nonZero = balances.filter(b => b.asset !== 'USDT' && parseFloat(b.free) + parseFloat(b.locked) > 0.000001)

    // Fetch prices for all non-zero positions to compute equity
    let equity_usd = cash_usd
    const positions: Record<string, number> = {}
    const position_details = []

    for (const bal of nonZero) {
      const qty = parseFloat(bal.free) + parseFloat(bal.locked)
      try {
        const priceRes = await axios.get(`${this.base}/api/v3/ticker/price`, {
          headers: this.headers(),
          params: { symbol: `${bal.asset}USDT` },
        })
        const price = parseFloat(priceRes.data.price)
        const market_value = qty * price
        const asset = `${bal.asset}/USD`
        equity_usd += market_value
        positions[asset] = qty
        position_details.push({
          asset,
          qty,
          market_value,
          unrealized_pl: 0,  // Binance doesn't return unrealized P&L without order history
          unrealized_plpc: 0,
          current_price: price,
          entry_price: 0,
        })
      } catch { /* skip unknown symbols */ }
    }

    return { cash_usd, equity_usd, positions, position_details }
  }

  async fetchMarketSnapshot(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}
    for (const asset of assets) {
      try {
        const symbol = toSymbol(asset)
        const [hourlyRes, dailyRes] = await Promise.all([
          axios.get(`${this.base}/api/v3/klines`, {
            headers: this.headers(),
            params: { symbol, interval: '1h', limit: 100 },
          }),
          axios.get(`${this.base}/api/v3/klines`, {
            headers: this.headers(),
            params: { symbol, interval: '1d', limit: 60 },
          }),
        ])
        // Binance kline format: [openTime, open, high, low, close, volume, ...]
        const bars = hourlyRes.data.map((k: any[]) => ({ t: new Date(k[0]).toISOString(), o: parseFloat(k[1]), h: parseFloat(k[2]), l: parseFloat(k[3]), c: parseFloat(k[4]), v: parseFloat(k[5]) }))
        const dailyBars = dailyRes.data.map((k: any[]) => ({ c: parseFloat(k[4]) }))

        if (!bars.length) continue
        const closes = bars.map((b: any) => b.c)
        const latest = bars[bars.length - 1]
        const prev24h = bars.length >= 24 ? bars[bars.length - 24] : bars[0]

        const rsi = computeRSIB(closes, 14)
        const ema9 = computeEMAB(closes, 9)
        const ema21 = computeEMAB(closes, 21)
        const macd = computeMACDB(closes)
        const bb = computeBBB(closes)
        const atr = computeATRB(bars)
        const volSma20 = bars.length >= 20 ? bars.slice(-20).reduce((s: number, b: any) => s + b.v, 0) / 20 : undefined

        let change_7d: number | undefined, daily_sma50: number | undefined
        if (dailyBars.length >= 7) {
          change_7d = parseFloat((((dailyBars[dailyBars.length - 1].c - dailyBars[dailyBars.length - 7].c) / dailyBars[dailyBars.length - 7].c) * 100).toFixed(2))
        }
        if (dailyBars.length >= 50) {
          daily_sma50 = parseFloat((dailyBars.slice(-50).reduce((a: number, b: any) => a + b.c, 0) / 50).toFixed(6))
        }

        snapshot[asset] = {
          price: latest.c,
          change_24h: parseFloat((((latest.c - prev24h.o) / prev24h.o) * 100).toFixed(2)),
          change_7d,
          volume_24h: bars.slice(-24).reduce((s: number, b: any) => s + b.v, 0),
          volume_sma20: volSma20 ? parseFloat(volSma20.toFixed(0)) : undefined,
          high_24h: Math.max(...bars.slice(-24).map((b: any) => b.h)),
          low_24h: Math.min(...bars.slice(-24).map((b: any) => b.l)),
          rsi_14: rsi,
          ema_9: ema9.length ? parseFloat(ema9[ema9.length - 1].toFixed(6)) : undefined,
          ema_21: ema21.length ? parseFloat(ema21[ema21.length - 1].toFixed(6)) : undefined,
          macd: macd?.macd, macd_signal: macd?.signal, macd_hist: macd?.hist,
          bb_upper: bb?.upper, bb_lower: bb?.lower, bb_pct: bb?.pct,
          atr_14: atr ?? undefined,
          daily_sma50,
        }
      } catch (err: any) {
        console.error(`[binance] ${asset}:`, err.message)
      }
    }
    return snapshot
  }

  async fetchLatestPrices(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}
    for (const asset of assets) {
      try {
        const res = await axios.get(`${this.base}/api/v3/ticker/price`, {
          headers: this.headers(),
          params: { symbol: toSymbol(asset) },
        })
        snapshot[asset] = { price: parseFloat(res.data.price), change_24h: 0, volume_24h: 0, high_24h: 0, low_24h: 0 }
      } catch { /* ignore */ }
    }
    return snapshot
  }

  async executeOrder(decision: Decision): Promise<OrderResult> {
    if (decision.action === 'hold') return { order_id: 'HOLD', status: 'skipped' }
    // Binance uses qty not notional — fetch price to compute qty
    const priceRes = await axios.get(`${this.base}/api/v3/ticker/price`, {
      headers: this.headers(),
      params: { symbol: toSymbol(decision.asset) },
    })
    const price = parseFloat(priceRes.data.price)
    const qty = (decision.amount_usd / price).toFixed(6)
    console.log(`[binance] Placing ${decision.action} ${qty} ${toSymbol(decision.asset)} @ ~$${price}`)
    const params = {
      symbol: toSymbol(decision.asset),
      side: decision.action.toUpperCase(),
      type: 'MARKET',
      quantity: qty,
    }
    const res = await axios.post(`${this.base}/api/v3/order?${this.sign(params)}`, null, {
      headers: this.headers(),
    })
    return {
      order_id: String(res.data.orderId),
      status: res.data.status,
      filled_at: res.data.transactTime ? new Date(res.data.transactTime).toISOString() : undefined,
      filled_avg_price: res.data.fills?.[0]?.price ? parseFloat(res.data.fills[0].price) : undefined,
    }
  }
}

// ─── Indicator helpers (same algorithms as alpaca.ts) ──────────────────────
function computeEMAB(values: number[], period: number): number[] {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  const result = [ema]
  for (let i = period; i < values.length; i++) { ema = values[i] * k + ema * (1 - k); result.push(ema) }
  return result
}
function computeRSIB(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff; else losses -= diff
  }
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  return parseFloat((100 - 100 / (1 + (gains / period) / avgLoss)).toFixed(2))
}
function computeMACDB(closes: number[]): { macd: number; signal: number; hist: number } | null {
  const e12 = computeEMAB(closes, 12), e26 = computeEMAB(closes, 26)
  if (!e12.length || !e26.length) return null
  const line = e26.map((v, i) => e12[i + (e12.length - e26.length)] - v)
  const sig = computeEMAB(line, 9)
  if (!sig.length) return null
  const m = line[line.length - 1], s = sig[sig.length - 1]
  return { macd: parseFloat(m.toFixed(6)), signal: parseFloat(s.toFixed(6)), hist: parseFloat((m - s).toFixed(6)) }
}
function computeBBB(closes: number[], period = 20): { upper: number; lower: number; pct: number } | null {
  if (closes.length < period) return null
  const sl = closes.slice(-period), sma = sl.reduce((a, b) => a + b, 0) / period
  const sd = Math.sqrt(sl.reduce((a, b) => a + (b - sma) ** 2, 0) / period)
  const upper = sma + 2 * sd, lower = sma - 2 * sd
  const pct = upper === lower ? 0.5 : (closes[closes.length - 1] - lower) / (upper - lower)
  return { upper: parseFloat(upper.toFixed(6)), lower: parseFloat(lower.toFixed(6)), pct: parseFloat(pct.toFixed(3)) }
}
function computeATRB(bars: any[], period = 14): number | null {
  if (bars.length < period + 1) return null
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)))
  const atr = computeEMAB(tr, period)
  return atr.length ? parseFloat(atr[atr.length - 1].toFixed(6)) : null
}
```

- [ ] **Step 2: Build**

```bash
cd agent && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add agent/src/exchanges/binance.ts
git commit -m "feat: add BinanceAdapter with HMAC auth, market snapshot, and order execution"
```

---

## Task 7: Coinbase adapter

**Files:**
- Create: `agent/src/exchanges/coinbase.ts`

- [ ] **Step 1: Create CoinbaseAdapter**

Create `agent/src/exchanges/coinbase.ts`:

```typescript
import axios from 'axios'
import jwt from 'jsonwebtoken'
import type { AssetSnapshot } from '../schema'
import type { ExchangeAdapter, Portfolio, OrderResult, Decision } from './adapter'
import { v4 as uuidv4 } from 'uuid'

const CB_BASE = 'https://api.coinbase.com'
// Coinbase doesn't have a reliable Advanced Trade sandbox; paper mode skips real execution
const CB_DATA = 'https://api.coinbase.com/api/v3/brokerage'

// 'BTC/USD' → 'BTC-USD', 'ETH/USD' → 'ETH-USD'
function toProductId(asset: string): string {
  return asset.replace('/', '-')
}
// 'BTC-USD' → 'BTC/USD'
function fromProductId(id: string): string {
  return id.replace('-', '/')
}

export class CoinbaseAdapter implements ExchangeAdapter {
  readonly exchange = 'coinbase'
  readonly mode: 'paper' | 'live'
  private apiKey: string
  private privateKeyPem: string

  constructor(apiKey: string, privateKeyPem: string, mode: 'paper' | 'live') {
    this.mode = mode
    this.apiKey = apiKey
    this.privateKeyPem = privateKeyPem
  }

  private buildJwt(method: string, path: string): string {
    const payload = {
      sub: this.apiKey,
      iss: 'cdp',
      nbf: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 120,
      'com.coinbasecloud.wallet.retail.trading.api.target_uri': `${method} api.coinbase.com${path}`,
    }
    return jwt.sign(payload, this.privateKeyPem, { algorithm: 'ES256' })
  }

  private authHeaders(method: string, path: string) {
    return {
      Authorization: `Bearer ${this.buildJwt(method, path)}`,
      'Content-Type': 'application/json',
    }
  }

  async fetchPortfolio(): Promise<Portfolio> {
    const path = '/api/v3/brokerage/accounts'
    const res = await axios.get(`${CB_BASE}${path}`, { headers: this.authHeaders('GET', path) })
    const accounts: any[] = res.data.accounts || []

    let cash_usd = 0
    const positions: Record<string, number> = {}
    const position_details = []

    for (const acc of accounts) {
      const currency: string = acc.currency
      const available = parseFloat(acc.available_balance?.value || '0')
      const hold = parseFloat(acc.hold?.value || '0')
      const total = available + hold
      if (total < 0.000001) continue

      if (currency === 'USD') {
        cash_usd = total
      } else {
        // Fetch current price to compute market value
        try {
          const productId = `${currency}-USD`
          const tickerPath = `/api/v3/brokerage/products/${productId}/ticker`
          const tickerRes = await axios.get(`${CB_BASE}${tickerPath}`, { headers: this.authHeaders('GET', tickerPath) })
          const price = parseFloat(tickerRes.data.trades?.[0]?.price || tickerRes.data.best_bid || '0')
          const asset = `${currency}/USD`
          positions[asset] = total
          position_details.push({
            asset,
            qty: total,
            market_value: total * price,
            unrealized_pl: 0,
            unrealized_plpc: 0,
            current_price: price,
            entry_price: 0,
          })
        } catch { /* skip unknown currencies */ }
      }
    }

    const equity_usd = cash_usd + position_details.reduce((s, p) => s + p.market_value, 0)
    return { cash_usd, equity_usd, positions, position_details }
  }

  async fetchMarketSnapshot(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}
    for (const asset of assets) {
      try {
        const productId = toProductId(asset)
        const now = Math.floor(Date.now() / 1000)
        const hourlyPath = `/api/v3/brokerage/products/${productId}/candles`
        const [hourlyRes, dailyRes] = await Promise.all([
          axios.get(`${CB_BASE}${hourlyPath}`, {
            headers: this.authHeaders('GET', hourlyPath),
            params: { start: now - 110 * 3600, end: now, granularity: 'ONE_HOUR' },
          }),
          axios.get(`${CB_BASE}${hourlyPath}`, {
            headers: this.authHeaders('GET', hourlyPath),
            params: { start: now - 65 * 86400, end: now, granularity: 'ONE_DAY' },
          }),
        ])
        // Coinbase candle format: { start, low, high, open, close, volume }
        const raw: any[] = hourlyRes.data.candles || []
        const bars = raw.map(c => ({ t: new Date(parseInt(c.start) * 1000).toISOString(), o: parseFloat(c.open), h: parseFloat(c.high), l: parseFloat(c.low), c: parseFloat(c.close), v: parseFloat(c.volume) }))
          .sort((a, b) => a.t.localeCompare(b.t))

        const rawDaily: any[] = dailyRes.data.candles || []
        const dailyBars = rawDaily.map(c => ({ c: parseFloat(c.close) })).sort((_, b) => 0)

        if (!bars.length) continue
        const closes = bars.map(b => b.c)
        const latest = bars[bars.length - 1]
        const prev24h = bars.length >= 24 ? bars[bars.length - 24] : bars[0]

        const rsi = computeRSIC(closes, 14)
        const ema9 = computeEMAC(closes, 9)
        const ema21 = computeEMAC(closes, 21)
        const macd = computeMACDC(closes)
        const bb = computeBBC(closes)
        const atr = computeATRC(bars)
        const volSma20 = bars.length >= 20 ? bars.slice(-20).reduce((s, b) => s + b.v, 0) / 20 : undefined

        let change_7d: number | undefined, daily_sma50: number | undefined
        if (dailyBars.length >= 7) {
          change_7d = parseFloat((((dailyBars[dailyBars.length - 1].c - dailyBars[dailyBars.length - 7].c) / dailyBars[dailyBars.length - 7].c) * 100).toFixed(2))
        }
        if (dailyBars.length >= 50) {
          daily_sma50 = parseFloat((dailyBars.slice(-50).reduce((a, b) => a + b.c, 0) / 50).toFixed(6))
        }

        snapshot[asset] = {
          price: latest.c,
          change_24h: parseFloat((((latest.c - prev24h.o) / prev24h.o) * 100).toFixed(2)),
          change_7d,
          volume_24h: bars.slice(-24).reduce((s, b) => s + b.v, 0),
          volume_sma20: volSma20 ? parseFloat(volSma20.toFixed(0)) : undefined,
          high_24h: Math.max(...bars.slice(-24).map(b => b.h)),
          low_24h: Math.min(...bars.slice(-24).map(b => b.l)),
          rsi_14: rsi,
          ema_9: ema9.length ? parseFloat(ema9[ema9.length - 1].toFixed(6)) : undefined,
          ema_21: ema21.length ? parseFloat(ema21[ema21.length - 1].toFixed(6)) : undefined,
          macd: macd?.macd, macd_signal: macd?.signal, macd_hist: macd?.hist,
          bb_upper: bb?.upper, bb_lower: bb?.lower, bb_pct: bb?.pct,
          atr_14: atr ?? undefined,
          daily_sma50,
        }
      } catch (err: any) {
        console.error(`[coinbase] ${asset}:`, err.message)
      }
    }
    return snapshot
  }

  async fetchLatestPrices(assets: string[]): Promise<Record<string, AssetSnapshot>> {
    const snapshot: Record<string, AssetSnapshot> = {}
    for (const asset of assets) {
      try {
        const path = `/api/v3/brokerage/products/${toProductId(asset)}/ticker`
        const res = await axios.get(`${CB_BASE}${path}`, { headers: this.authHeaders('GET', path) })
        const price = parseFloat(res.data.trades?.[0]?.price || res.data.best_bid || '0')
        snapshot[asset] = { price, change_24h: 0, volume_24h: 0, high_24h: price, low_24h: price }
      } catch { /* ignore */ }
    }
    return snapshot
  }

  async executeOrder(decision: Decision): Promise<OrderResult> {
    if (decision.action === 'hold') return { order_id: 'HOLD', status: 'skipped' }
    if (this.mode === 'paper') {
      // Coinbase has no reliable sandbox for Advanced Trade — simulate in paper mode
      console.log(`[coinbase:paper] Simulated ${decision.action} $${decision.amount_usd} of ${decision.asset}`)
      return { order_id: `PAPER-${Date.now()}`, status: 'filled' }
    }
    const path = '/api/v3/brokerage/orders'
    const body = {
      client_order_id: uuidv4(),
      product_id: toProductId(decision.asset),
      side: decision.action === 'buy' ? 'BUY' : 'SELL',
      order_configuration: {
        market_market_ioc: {
          quote_size: decision.amount_usd.toFixed(2),
        },
      },
    }
    console.log(`[coinbase] Placing ${decision.action} $${decision.amount_usd} of ${decision.asset}`)
    const res = await axios.post(`${CB_BASE}${path}`, body, { headers: this.authHeaders('POST', path) })
    const order = res.data.success_response
    return {
      order_id: order.order_id,
      status: 'pending',
    }
  }
}

// ─── Indicator helpers ──────────────────────────────────────────────────────
function computeEMAC(values: number[], period: number): number[] {
  if (values.length < period) return []
  const k = 2 / (period + 1)
  let ema = values.slice(0, period).reduce((a, b) => a + b, 0) / period
  const result = [ema]
  for (let i = period; i < values.length; i++) { ema = values[i] * k + ema * (1 - k); result.push(ema) }
  return result
}
function computeRSIC(closes: number[], period: number): number {
  if (closes.length < period + 1) return 50
  let gains = 0, losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1]
    if (diff >= 0) gains += diff; else losses -= diff
  }
  const avgLoss = losses / period
  if (avgLoss === 0) return 100
  return parseFloat((100 - 100 / (1 + (gains / period) / avgLoss)).toFixed(2))
}
function computeMACDC(closes: number[]): { macd: number; signal: number; hist: number } | null {
  const e12 = computeEMAC(closes, 12), e26 = computeEMAC(closes, 26)
  if (!e12.length || !e26.length) return null
  const line = e26.map((v, i) => e12[i + (e12.length - e26.length)] - v)
  const sig = computeEMAC(line, 9)
  if (!sig.length) return null
  const m = line[line.length - 1], s = sig[sig.length - 1]
  return { macd: parseFloat(m.toFixed(6)), signal: parseFloat(s.toFixed(6)), hist: parseFloat((m - s).toFixed(6)) }
}
function computeBBC(closes: number[], period = 20): { upper: number; lower: number; pct: number } | null {
  if (closes.length < period) return null
  const sl = closes.slice(-period), sma = sl.reduce((a, b) => a + b, 0) / period
  const sd = Math.sqrt(sl.reduce((a, b) => a + (b - sma) ** 2, 0) / period)
  const upper = sma + 2 * sd, lower = sma - 2 * sd
  const pct = upper === lower ? 0.5 : (closes[closes.length - 1] - lower) / (upper - lower)
  return { upper: parseFloat(upper.toFixed(6)), lower: parseFloat(lower.toFixed(6)), pct: parseFloat(pct.toFixed(3)) }
}
function computeATRC(bars: any[], period = 14): number | null {
  if (bars.length < period + 1) return null
  const tr = bars.slice(1).map((b, i) => Math.max(b.h - b.l, Math.abs(b.h - bars[i].c), Math.abs(b.l - bars[i].c)))
  const atr = computeEMAC(tr, period)
  return atr.length ? parseFloat(atr[atr.length - 1].toFixed(6)) : null
}
```

- [ ] **Step 2: Install uuid (needed for Coinbase client_order_id)**

```bash
cd agent && npm install uuid && npm install --save-dev @types/uuid
```

- [ ] **Step 3: Build**

```bash
cd agent && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add agent/src/exchanges/coinbase.ts agent/package.json agent/package-lock.json
git commit -m "feat: add CoinbaseAdapter with JWT auth and Advanced Trade API"
```

---

## Task 8: Exchange factory + keys.ts update

**Files:**
- Create: `agent/src/exchanges/index.ts`
- Modify: `agent/src/keys.ts`

- [ ] **Step 1: Create the factory**

Create `agent/src/exchanges/index.ts`:

```typescript
import { AlpacaAdapter } from './alpaca'
import { BinanceAdapter } from './binance'
import { CoinbaseAdapter } from './coinbase'
import type { ExchangeAdapter } from './adapter'
import type { WalletDoc } from '../schema'

export { ExchangeAdapter } from './adapter'
export type { Portfolio, PositionDetail, OrderResult, Decision } from './adapter'

export function createAdapter(wallet: WalletDoc): ExchangeAdapter {
  const mode = wallet.mode ?? 'paper'
  switch (wallet.exchange ?? 'alpaca') {
    case 'binance':
      return new BinanceAdapter(wallet.binance_api_key, wallet.binance_api_secret, mode)
    case 'coinbase':
      return new CoinbaseAdapter(wallet.coinbase_api_key, wallet.coinbase_api_secret, mode)
    case 'alpaca':
    default:
      return new AlpacaAdapter(wallet.alpaca_api_key, wallet.alpaca_api_secret, mode, wallet.alpaca_base_url)
  }
}
```

- [ ] **Step 2: Add getAdapterForUser to keys.ts**

In `agent/src/keys.ts`, add the following import at the top:

```typescript
import { createAdapter } from './exchanges'
import type { ExchangeAdapter } from './exchanges'
```

Then add the following function after `getUserKeySet`:

```typescript
export async function getAdapterForUser(userId: string): Promise<ExchangeAdapter> {
  const wallet = await getActiveWallet(userId)
  if (!wallet) throw new Error(`No active wallet for user ${userId}`)
  return createAdapter(wallet as any)
}
```

- [ ] **Step 3: Update UserWalletInfo and listUserWallets to expose exchange and mode**

Replace `UserWalletInfo` interface:

```typescript
export interface UserWalletInfo {
  id: string
  name: string
  active: boolean
  exchange: 'alpaca' | 'binance' | 'coinbase'
  mode: 'paper' | 'live'
  alpaca_api_key_masked: string
  alpaca_api_secret_masked: string
  alpaca_base_url: string
  binance_api_key_masked: string
  coinbase_api_key_masked: string
}
```

Update `listUserWallets` to return new fields:

```typescript
export async function listUserWallets(userId: string): Promise<UserWalletInfo[]> {
  await ensureWalletSeededFromLegacyKeys(userId)
  const rows = await WalletModel.find({ userId }).sort({ createdAt: 1 }).lean()
  return rows.map((w: any) => ({
    id: w._id.toString(),
    name: w.name,
    active: Boolean(w.active),
    exchange: w.exchange ?? 'alpaca',
    mode: w.mode ?? 'paper',
    alpaca_api_key_masked: maskSecret(w.alpaca_api_key || ''),
    alpaca_api_secret_masked: maskSecret(w.alpaca_api_secret || ''),
    alpaca_base_url: w.alpaca_base_url || '',
    binance_api_key_masked: maskSecret(w.binance_api_key || ''),
    coinbase_api_key_masked: maskSecret(w.coinbase_api_key || ''),
  }))
}
```

- [ ] **Step 4: Update createUserWallet to accept exchange and mode**

Replace `createUserWallet` signature and body:

```typescript
export async function createUserWallet(
  userId: string,
  payload: {
    name: string
    exchange?: 'alpaca' | 'binance' | 'coinbase'
    mode?: 'paper' | 'live'
    alpaca_api_key?: string
    alpaca_api_secret?: string
    alpaca_base_url?: string
    binance_api_key?: string
    binance_api_secret?: string
    coinbase_api_key?: string
    coinbase_api_secret?: string
  }
): Promise<UserWalletInfo> {
  const name = payload.name.trim()
  const existing = await WalletModel.findOne({ userId, name }).lean()
  if (existing) throw new Error('Wallet name already exists')
  const hasAny = await WalletModel.exists({ userId })
  const wallet = await WalletModel.create({
    userId,
    name,
    active: !hasAny,
    exchange: payload.exchange ?? 'alpaca',
    mode: payload.mode ?? 'paper',
    alpaca_api_key: (payload.alpaca_api_key || '').trim(),
    alpaca_api_secret: (payload.alpaca_api_secret || '').trim(),
    alpaca_base_url: (payload.alpaca_base_url || 'https://paper-api.alpaca.markets').trim(),
    binance_api_key: (payload.binance_api_key || '').trim(),
    binance_api_secret: (payload.binance_api_secret || '').trim(),
    coinbase_api_key: (payload.coinbase_api_key || '').trim(),
    coinbase_api_secret: (payload.coinbase_api_secret || '').trim(),
  })
  return {
    id: wallet._id.toString(),
    name: wallet.name,
    active: wallet.active,
    exchange: (wallet as any).exchange ?? 'alpaca',
    mode: (wallet as any).mode ?? 'paper',
    alpaca_api_key_masked: maskSecret(wallet.alpaca_api_key),
    alpaca_api_secret_masked: maskSecret(wallet.alpaca_api_secret),
    alpaca_base_url: wallet.alpaca_base_url,
    binance_api_key_masked: maskSecret((wallet as any).binance_api_key || ''),
    coinbase_api_key_masked: maskSecret((wallet as any).coinbase_api_key || ''),
  }
}
```

- [ ] **Step 5: Build**

```bash
cd agent && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add agent/src/exchanges/index.ts agent/src/keys.ts
git commit -m "feat: add exchange factory and update keys.ts for multi-exchange wallet support"
```

---

## Task 9: Update risk.ts and engineManager.ts to use adapter

**Files:**
- Modify: `agent/src/risk.ts`
- Modify: `agent/src/engineManager.ts`

- [ ] **Step 1: Update risk.ts — replace AlpacaCredentials with ExchangeAdapter**

In `agent/src/risk.ts`, replace the import block at the top:

```typescript
import { TradeModel, EquityModel, AssetSnapshot, PositionHighModel } from './schema'
import { AgentConfig, getConfig } from './config'
import { markExecuted } from './logger'
import type { ExchangeAdapter } from './exchanges'
```

(Remove the `import { executeOrder } from './executor'` and `import type { AlpacaCredentials } from './executor'` lines.)

Update `monitorStopLossTakeProfit` signature:

```typescript
export async function monitorStopLossTakeProfit(
  currentPrices: Record<string, AssetSnapshot>,
  userId = '__global__',
  adapter: ExchangeAdapter,
  configOverride?: AgentConfig,
): Promise<void> {
```

In the function body, replace `await executeOrder({...}, creds)` with `await adapter.executeOrder({...})`:

```typescript
    try {
      const result = await adapter.executeOrder({
        action: 'sell',
        asset: trade.decision.asset,
        amount_usd: trade.decision.amount_usd,
        confidence: 1.0,
        reasoning: `${triggered.toUpperCase()} triggered at $${currentPrice}`,
      })
      await markExecuted(trade._id.toString(), result.order_id)
```

Update `updateAndCheckTrailingStops` signature similarly:

```typescript
export async function updateAndCheckTrailingStops(
  currentPrices: Record<string, AssetSnapshot>,
  userId = '__global__',
  adapter: ExchangeAdapter,
  configOverride?: AgentConfig,
): Promise<void> {
```

Replace all `executeOrder({...}, creds)` calls in `updateAndCheckTrailingStops` with `adapter.executeOrder({...})`.

Also update the call to `updateAndCheckTrailingStops` inside `monitorStopLossTakeProfit`:

```typescript
  await updateAndCheckTrailingStops(currentPrices, userId, adapter, configOverride)
```

- [ ] **Step 2: Update engineManager.ts — use adapter throughout**

In `agent/src/engineManager.ts`, replace the import block:

```typescript
import { UserModel, TradeModel, type AssetSnapshot } from './schema'
import { fetchFearAndGreed, fetchNewsHeadlines } from './sentiment'
import { getDecisions, type Decision } from './brain'
import { getUserConfig, type AgentConfig } from './config'
import { getUserKeySet } from './keys'
import { getAdapterForUser } from './keys'
import { getStrategy, mergeWithDefaults } from './strategies/registry'
import { logDecision, markExecuted, markExecutionFailed, resolveOutcomes, supersedePendingManualApprovals } from './logger'
import { getRiskStatus, kellyPositionSize, monitorStopLossTakeProfit, recordEquitySnapshot } from './risk'
import { broadcast } from './ws'
```

(Remove `import { fetchPortfolio, fetchMarketSnapshot, fetchLatestPrices } from './poller'` and `import { executeOrder } from './executor'`.)

Update `refreshMarketData` to accept and use the adapter:

```typescript
  private async refreshMarketData(
    rt: UserRuntime,
    cfg: AgentConfig,
    force = false
  ): Promise<{ portfolio: Awaited<ReturnType<typeof import('./poller').fetchPortfolio>>; market: Record<string, AssetSnapshot> }> {
```

Actually, the return type needs to use the `Portfolio` type from the adapter. Replace the return type annotation to use the adapter's `Portfolio`:

```typescript
  private async refreshMarketData(
    rt: UserRuntime,
    cfg: AgentConfig,
    force = false
  ): Promise<{ portfolio: import('./exchanges/adapter').Portfolio; market: Record<string, AssetSnapshot> }> {
    const cacheMaxAgeMs = Math.max(15_000, cfg.marketDataMinutes * 60 * 1000 - 5_000)
    const cacheFresh = !force && rt.cachedPortfolio && rt.cachedMarket && (Date.now() - rt.cachedAt) < cacheMaxAgeMs
    if (cacheFresh) return { portfolio: rt.cachedPortfolio!, market: rt.cachedMarket! }

    const adapter = await getAdapterForUser(rt.userId)
    const [portfolio, market] = await Promise.all([
      adapter.fetchPortfolio(),
      adapter.fetchMarketSnapshot(cfg.assets),
    ])
    rt.cachedPortfolio = portfolio
    rt.cachedMarket = market
    rt.cachedAt = Date.now()
    rt.lastDataRefreshAt = new Date().toISOString()
    broadcast('portfolio', { cash: portfolio.cash_usd, equity: portfolio.equity_usd }, rt.userId)
    return { portfolio, market }
  }
```

Update `cachedPortfolio` type in `UserRuntime` interface:

```typescript
  cachedPortfolio: import('./exchanges/adapter').Portfolio | null
```

Update `scheduleRiskMonitor` to use adapter instead of creds:

```typescript
  private scheduleRiskMonitor(rt: UserRuntime): void {
    if (!rt.active) return
    const loop = async () => {
      rt.nextRiskCheckAt = new Date(Date.now() + 2 * 60_000).toISOString()
      rt.riskTimer = setTimeout(async () => {
        try {
          const [cfg, adapter] = await Promise.all([getUserConfig(rt.userId), getAdapterForUser(rt.userId)])
          const prices = await adapter.fetchLatestPrices(cfg.assets)
          await monitorStopLossTakeProfit(prices, rt.userId, adapter, cfg)
        } catch (e: any) {
          console.error(`[engine:${rt.username}] risk monitor error:`, e.message)
        }
        loop()
      }, 2 * 60_000)
    }
    loop()
  }
```

In `runCycle`, replace the creds-based approach:

Find and remove:
```typescript
    const keys = await getUserKeySet(rt.userId)
    const creds = { alpaca_api_key: keys.alpaca_api_key, alpaca_api_secret: keys.alpaca_api_secret, alpaca_base_url: keys.alpaca_base_url }
```

Replace `executeOrder(decision, creds)` with `adapter.executeOrder(decision)` where adapter is resolved via `getAdapterForUser` at the top of `runCycle`:

```typescript
  private async runCycle(rt: UserRuntime): Promise<void> {
    if (!rt.active || rt.paused || rt.blocked) return
    const cfg = await getUserConfig(rt.userId)
    const keys = await getUserKeySet(rt.userId)  // still needed for AI keys
    const adapter = await getAdapterForUser(rt.userId)
    try {
      const { portfolio, market } = await this.refreshMarketData(rt, cfg)
      // ... rest of cycle unchanged except:
      // Replace: const result = await executeOrder(decision, creds)
      // With:    const result = await adapter.executeOrder(decision)
```

And in the news/sentiment fetch, replace:
```typescript
      const creds = { alpaca_api_key: keys.alpaca_api_key, ... }
      const [fearGreed, news] = await Promise.all([
        fetchFearAndGreed(),
        fetchNewsHeadlines(cfg.assets, creds),
      ])
```
With:
```typescript
      const [fearGreed, news] = await Promise.all([
        fetchFearAndGreed(),
        fetchNewsHeadlines(cfg.assets, {
          alpaca_api_key: keys.alpaca_api_key,
          alpaca_api_secret: keys.alpaca_api_secret,
          alpaca_base_url: keys.alpaca_base_url,
        }),
      ])
```

(News headlines still use Alpaca credentials for market data; this is acceptable as news is fetched from a separate sentiment service, not exchange-specific.)

- [ ] **Step 3: Build**

```bash
cd agent && npx tsc --noEmit
```

Fix any remaining type errors iteratively.

- [ ] **Step 4: Commit**

```bash
git add agent/src/risk.ts agent/src/engineManager.ts
git commit -m "feat: migrate engine and risk monitor to use ExchangeAdapter"
```

---

## Task 10: API updates — positions, wallet mode endpoint, wallet creation

**Files:**
- Modify: `agent/src/api.ts`

- [ ] **Step 1: Update /api/positions to use adapter**

Find the `GET /api/positions` handler (around line 308) and replace:

```typescript
  app.get('/api/positions', requireAuth, async (req, res) => {
    try {
      const adapter = await getAdapterForUser(currentUserId(req))
      const portfolio = await adapter.fetchPortfolio()
      res.json(portfolio.position_details)
    } catch {
      res.json([])
    }
  })
```

Add the import for `getAdapterForUser` at the top of `api.ts`:

```typescript
import { getAdapterForUser } from './keys'
```

- [ ] **Step 2: Add POST /api/wallets/:id/mode endpoint**

After the existing `DELETE /api/wallets/:id` handler, add:

```typescript
  // POST /api/wallets/:id/mode — switch paper/live mode (requires 2FA token for live)
  app.post('/api/wallets/:id/mode', requireAuth, async (req, res) => {
    const userId = currentUserId(req)
    const { mode, token } = req.body
    if (mode !== 'paper' && mode !== 'live') {
      return res.status(400).json({ error: 'mode must be "paper" or "live"' })
    }
    if (mode === 'live') {
      // Require 2FA verification before switching to live
      const user = await UserModel.findById(userId).lean()
      if (!user) return res.status(401).json({ error: 'User not found' })
      if (user.twoFactorEnabled) {
        if (!token) return res.status(403).json({ error: '2FA token required to enable live trading' })
        const { verifyTOTP } = await import('./auth')
        const valid = verifyTOTP(user.twoFactorSecret!, token)
        if (!valid) return res.status(403).json({ error: 'Invalid 2FA token' })
      }
    }
    const wallet = await WalletModel.findOne({ _id: req.params.id, userId })
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' })
    wallet.mode = mode
    await wallet.save()
    await logAudit(`wallet.mode.${mode}`, `Wallet "${wallet.name}" switched to ${mode} mode`, currentUser(req), req)
    res.json({ id: wallet._id.toString(), mode })
  })
```

- [ ] **Step 3: Update POST /api/wallets to accept exchange and mode**

Find the wallet creation handler (`app.post('/api/wallets'`) and update its body parsing:

```typescript
  app.post('/api/wallets', requireAuth, async (req, res) => {
    try {
      const { name, exchange, mode, alpaca_api_key, alpaca_api_secret, alpaca_base_url,
              binance_api_key, binance_api_secret, coinbase_api_key, coinbase_api_secret } = req.body
      const wallet = await createUserWallet(currentUserId(req), {
        name, exchange, mode,
        alpaca_api_key, alpaca_api_secret, alpaca_base_url,
        binance_api_key, binance_api_secret,
        coinbase_api_key, coinbase_api_secret,
      })
      res.json(wallet)
    } catch (err: any) {
      res.status(400).json({ error: err.message })
    }
  })
```

- [ ] **Step 4: Add GET /api/wallets/active-mode endpoint for live banner**

After the wallets list endpoint, add:

```typescript
  app.get('/api/wallets/active-mode', requireAuth, async (req, res) => {
    const wallet = await WalletModel.findOne({ userId: currentUserId(req), active: true }).lean()
    res.json({
      mode: (wallet as any)?.mode ?? 'paper',
      exchange: (wallet as any)?.exchange ?? 'alpaca',
      name: (wallet as any)?.name ?? 'Default',
    })
  })
```

Add `WalletModel` to the imports at the top of `api.ts` if not already imported:

```typescript
import { ..., WalletModel } from './schema'
```

- [ ] **Step 5: Build**

```bash
cd agent && npx tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add agent/src/api.ts
git commit -m "feat: update /api/positions to use adapter, add wallet mode endpoint, update wallet creation"
```

---

## Task 11: Frontend — live mode banner + wallet mode toggle

**Files:**
- Modify: `dashboard/src/api.ts`
- Modify: `dashboard/src/pages/Overview.tsx` (add live banner)
- Modify: `dashboard/src/pages/Settings.tsx` (add mode toggle to wallet section)

- [ ] **Step 1: Add API calls to dashboard/src/api.ts**

In `dashboard/src/api.ts`, add these functions:

```typescript
export async function getActiveWalletMode(): Promise<{ mode: 'paper' | 'live'; exchange: string; name: string }> {
  const res = await fetch('/api/wallets/active-mode', { headers: authHeaders() })
  return res.json()
}

export async function setWalletMode(walletId: string, mode: 'paper' | 'live', token?: string): Promise<{ id: string; mode: string }> {
  const res = await fetch(`/api/wallets/${walletId}/mode`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode, token }),
  })
  if (!res.ok) {
    const err = await res.json()
    throw new Error(err.error || 'Failed to set mode')
  }
  return res.json()
}
```

- [ ] **Step 2: Add live banner to Overview.tsx**

Near the top of `Overview.tsx` JSX (after any header/nav, before the main content), add a live banner that fetches mode on mount:

```tsx
// Add to imports:
import { getActiveWalletMode } from '../api'

// Add to component state:
const [walletMode, setWalletMode] = useState<'paper' | 'live'>('paper')

// Add to useEffect (or a new useEffect):
useEffect(() => {
  getActiveWalletMode().then(w => setWalletMode(w.mode)).catch(() => {})
}, [])

// Add to JSX near top of return:
{walletMode === 'live' && (
  <div style={{
    background: '#dc2626',
    color: 'white',
    textAlign: 'center',
    padding: '8px 16px',
    fontWeight: 600,
    fontSize: '14px',
    letterSpacing: '0.05em',
  }}>
    ⚠ LIVE TRADING ACTIVE — Real funds at risk
  </div>
)}
```

- [ ] **Step 3: Add mode toggle to Settings.tsx wallet section**

In the wallet list UI in `Settings.tsx`, for each wallet row, add a mode badge and toggle button. Find where wallets are rendered (look for `wallet.name` in the JSX) and add:

```tsx
// In the wallet list map, next to each wallet's name/actions:
<span style={{
  padding: '2px 8px',
  borderRadius: '4px',
  fontSize: '11px',
  fontWeight: 700,
  background: wallet.mode === 'live' ? '#dc2626' : '#16a34a',
  color: 'white',
  marginLeft: '8px',
}}>
  {wallet.mode === 'live' ? 'LIVE' : 'PAPER'}
</span>
<button
  onClick={() => handleModeToggle(wallet)}
  style={{ marginLeft: '8px', fontSize: '11px' }}
>
  Switch to {wallet.mode === 'live' ? 'Paper' : 'Live'}
</button>
```

Add the `handleModeToggle` function:

```tsx
const handleModeToggle = async (wallet: any) => {
  const targetMode = wallet.mode === 'live' ? 'paper' : 'live'
  let token: string | undefined
  if (targetMode === 'live') {
    token = prompt('Enter your 2FA code to enable live trading:') ?? undefined
    if (!token) return
  }
  try {
    await setWalletMode(wallet.id, targetMode, token)
    // Refresh wallet list
    loadWallets()
  } catch (err: any) {
    alert(err.message)
  }
}
```

Add `setWalletMode` to the import from `'../api'`.

- [ ] **Step 4: Update wallet creation form in Settings.tsx to include exchange + mode**

Find the wallet creation form and add:

```tsx
// Add state:
const [newWalletExchange, setNewWalletExchange] = useState<'alpaca' | 'binance' | 'coinbase'>('alpaca')
const [newWalletMode, setNewWalletMode] = useState<'paper' | 'live'>('paper')

// Add fields before the credential inputs:
<select value={newWalletExchange} onChange={e => setNewWalletExchange(e.target.value as any)}>
  <option value="alpaca">Alpaca</option>
  <option value="binance">Binance</option>
  <option value="coinbase">Coinbase</option>
</select>

<select value={newWalletMode} onChange={e => setNewWalletMode(e.target.value as any)}>
  <option value="paper">Paper</option>
  <option value="live">Live</option>
</select>

// Show exchange-specific credential fields:
{newWalletExchange === 'alpaca' && (
  <>
    <input placeholder="Alpaca API Key" ... />
    <input placeholder="Alpaca API Secret" ... />
    <input placeholder="Base URL (optional)" ... />
  </>
)}
{newWalletExchange === 'binance' && (
  <>
    <input placeholder="Binance API Key" ... />
    <input placeholder="Binance API Secret" ... />
  </>
)}
{newWalletExchange === 'coinbase' && (
  <>
    <input placeholder="Coinbase API Key (CDP)" ... />
    <textarea placeholder="Coinbase Private Key PEM" rows={4} ... />
  </>
)}
```

Include `exchange`, `mode`, and the exchange-specific credentials in the wallet creation payload sent to the API.

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/api.ts dashboard/src/pages/Overview.tsx dashboard/src/pages/Settings.tsx
git commit -m "feat: add live mode banner, wallet mode toggle, and exchange selector in wallet creation"
```

---

## Task 12: Monthly/Weekly P&L backend

**Files:**
- Modify: `agent/src/api.ts`

- [ ] **Step 1: Add /api/stats/per-period endpoint**

After the existing `GET /api/stats/per-asset` handler in `api.ts`, add:

```typescript
  // GET /api/stats/per-period?period=daily|weekly|monthly
  app.get('/api/stats/per-period', requireAuth, async (req, res) => {
    const period = (req.query.period as string) || 'daily'
    const scope = isAdmin(req) ? {} : { userId: currentUserId(req) }

    let groupId: any
    if (period === 'monthly') {
      groupId = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
      }
    } else if (period === 'weekly') {
      groupId = {
        year: { $isoWeekYear: '$timestamp' },
        week: { $isoWeek: '$timestamp' },
      }
    } else {
      // daily
      groupId = {
        year: { $year: '$timestamp' },
        month: { $month: '$timestamp' },
        day: { $dayOfMonth: '$timestamp' },
      }
    }

    const results = await TradeModel.aggregate([
      { $match: { ...scope, 'outcome.pnl_usd': { $exists: true } } },
      { $group: {
        _id: groupId,
        total_pnl: { $sum: '$outcome.pnl_usd' },
        trade_count: { $sum: 1 },
        wins: { $sum: { $cond: ['$outcome.correct', 1, 0] } },
        avg_win: { $avg: { $cond: [{ $gt: ['$outcome.pnl_usd', 0] }, '$outcome.pnl_usd', null] } },
        avg_loss: { $avg: { $cond: [{ $lt: ['$outcome.pnl_usd', 0] }, '$outcome.pnl_usd', null] } },
      }},
      { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.week': 1 } },
    ])

    res.json(results.map(r => {
      let label: string
      if (period === 'monthly') {
        label = `${r._id.year}-${String(r._id.month).padStart(2, '0')}`
      } else if (period === 'weekly') {
        label = `${r._id.year}-W${String(r._id.week).padStart(2, '0')}`
      } else {
        label = `${r._id.year}-${String(r._id.month).padStart(2, '0')}-${String(r._id.day).padStart(2, '0')}`
      }
      return {
        period: label,
        total_pnl: parseFloat((r.total_pnl ?? 0).toFixed(2)),
        trade_count: r.trade_count,
        win_rate: r.trade_count > 0 ? parseFloat(((r.wins / r.trade_count) * 100).toFixed(1)) : 0,
        avg_win: r.avg_win ? parseFloat(r.avg_win.toFixed(2)) : null,
        avg_loss: r.avg_loss ? parseFloat(r.avg_loss.toFixed(2)) : null,
      }
    }))
  })
```

- [ ] **Step 2: Build**

```bash
cd agent && npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add agent/src/api.ts
git commit -m "feat: add /api/stats/per-period endpoint with daily/weekly/monthly grouping"
```

---

## Task 13: Monthly/Weekly P&L frontend

**Files:**
- Modify: `dashboard/src/api.ts`
- Modify: `dashboard/src/pages/Overview.tsx`

- [ ] **Step 1: Add getStatsPerPeriod to dashboard/src/api.ts**

```typescript
export async function getStatsPerPeriod(period: 'daily' | 'weekly' | 'monthly'): Promise<Array<{
  period: string
  total_pnl: number
  trade_count: number
  win_rate: number
  avg_win: number | null
  avg_loss: number | null
}>> {
  const res = await fetch(`/api/stats/per-period?period=${period}`, { headers: authHeaders() })
  return res.json()
}
```

- [ ] **Step 2: Add period P&L section to Overview.tsx**

Add state and data fetching:

```tsx
// Add to imports:
import { getStatsPerPeriod } from '../api'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'

// Add state:
const [pnlPeriod, setPnlPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily')
const [periodPnl, setPeriodPnl] = useState<any[]>([])

// Add effect:
useEffect(() => {
  getStatsPerPeriod(pnlPeriod).then(setPeriodPnl).catch(() => {})
}, [pnlPeriod])
```

Add the P&L chart section to the JSX (find the existing P&L or stats section and add below it):

```tsx
<div style={{ marginTop: '24px' }}>
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
    <h3 style={{ margin: 0 }}>P&L Breakdown</h3>
    {(['daily', 'weekly', 'monthly'] as const).map(p => (
      <button
        key={p}
        onClick={() => setPnlPeriod(p)}
        style={{
          padding: '4px 12px',
          borderRadius: '999px',
          border: '1px solid #374151',
          background: pnlPeriod === p ? '#3b82f6' : 'transparent',
          color: pnlPeriod === p ? 'white' : 'inherit',
          cursor: 'pointer',
          fontSize: '13px',
          textTransform: 'capitalize',
        }}
      >
        {p}
      </button>
    ))}
  </div>

  <ResponsiveContainer width="100%" height={200}>
    <BarChart data={periodPnl.slice(-30)}>
      <XAxis dataKey="period" tick={{ fontSize: 11 }} tickLine={false} />
      <YAxis tickFormatter={v => `$${v}`} tick={{ fontSize: 11 }} tickLine={false} />
      <Tooltip formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'P&L']} />
      <Bar dataKey="total_pnl" radius={[3, 3, 0, 0]}>
        {periodPnl.slice(-30).map((entry, i) => (
          <Cell key={i} fill={entry.total_pnl >= 0 ? '#22c55e' : '#ef4444'} />
        ))}
      </Bar>
    </BarChart>
  </ResponsiveContainer>

  <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse', marginTop: '8px' }}>
    <thead>
      <tr style={{ borderBottom: '1px solid #374151' }}>
        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Period</th>
        <th style={{ textAlign: 'right', padding: '4px 8px' }}>P&L</th>
        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Trades</th>
        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Win Rate</th>
        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Avg Win</th>
        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Avg Loss</th>
      </tr>
    </thead>
    <tbody>
      {[...periodPnl].reverse().slice(0, 10).map((row, i) => (
        <tr key={i} style={{ borderBottom: '1px solid #1f2937' }}>
          <td style={{ padding: '4px 8px' }}>{row.period}</td>
          <td style={{ padding: '4px 8px', textAlign: 'right', color: row.total_pnl >= 0 ? '#22c55e' : '#ef4444' }}>
            ${row.total_pnl.toFixed(2)}
          </td>
          <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.trade_count}</td>
          <td style={{ padding: '4px 8px', textAlign: 'right' }}>{row.win_rate}%</td>
          <td style={{ padding: '4px 8px', textAlign: 'right', color: '#22c55e' }}>
            {row.avg_win != null ? `$${row.avg_win.toFixed(2)}` : '—'}
          </td>
          <td style={{ padding: '4px 8px', textAlign: 'right', color: '#ef4444' }}>
            {row.avg_loss != null ? `$${row.avg_loss.toFixed(2)}` : '—'}
          </td>
        </tr>
      ))}
    </tbody>
  </table>
</div>
```

- [ ] **Step 3: Build dashboard**

```bash
cd dashboard && npm run build
```

Expected: build succeeds

- [ ] **Step 4: Commit**

```bash
git add dashboard/src/api.ts dashboard/src/pages/Overview.tsx
git commit -m "feat: add weekly/monthly P&L chart and table with period toggle to Overview"
```

---

## Task 14: Portfolio Allocation UI

**Files:**
- Create: `dashboard/src/components/AllocationCard.tsx`
- Modify: `dashboard/src/pages/Overview.tsx`
- Modify: `dashboard/src/api.ts`

- [ ] **Step 1: Add API call for stats (needed for win rate)**

In `dashboard/src/api.ts`, add if not already present:

```typescript
export async function getStats(): Promise<{
  total_pnl_usd: string
  win_rate: string
  executed_trades: number
  profitable_trades: number
}> {
  const res = await fetch('/api/stats', { headers: authHeaders() })
  return res.json()
}

export async function getPositions(): Promise<Array<{
  asset: string
  qty: number
  market_value: number
  unrealized_pl: number
  unrealized_plpc: number
  current_price: number
  entry_price: number
}>> {
  const res = await fetch('/api/positions', { headers: authHeaders() })
  return res.json()
}

export async function getConfig(): Promise<{ assets: string[]; [key: string]: any }> {
  const res = await fetch('/api/config', { headers: authHeaders() })
  return res.json()
}
```

- [ ] **Step 2: Create AllocationCard.tsx**

Create `dashboard/src/components/AllocationCard.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { getPositions, getStats, getConfig } from '../api'

interface AllocationRow {
  asset: string
  value: number
  allocation: number
  kellySizeUsd: number
  atrSizeUsd: number | null
  currentPrice: number
  atr14: number | null
}

const MAX_POSITION_USD = 500  // matches agent default; ideally fetched from config

export function AllocationCard({ marketSnapshot }: { marketSnapshot?: Record<string, any> }) {
  const [rows, setRows] = useState<AllocationRow[]>([])
  const [cashRow, setCashRow] = useState<{ value: number; allocation: number } | null>(null)
  const [totalEquity, setTotalEquity] = useState(0)

  useEffect(() => {
    async function load() {
      const [positions, stats, config] = await Promise.all([
        getPositions(),
        getStats(),
        getConfig(),
      ])

      const winRate = parseFloat(stats.win_rate) / 100
      const executedTrades = stats.executed_trades
      const profitableTrades = stats.profitable_trades

      // Payoff ratio: need avg win / avg loss — approximate from P&L and counts
      // Without per-trade details, use 1.5 as a reasonable default
      const payoffRatio = 1.5
      // Half-Kelly: f* = (bp - q) / b * 0.5
      const kellyFraction = winRate > 0
        ? Math.max(0, ((payoffRatio * winRate - (1 - winRate)) / payoffRatio) * 0.5)
        : 0

      const portfolioValue = positions.reduce((s, p) => s + p.market_value, 0)
      // Estimate cash from equity — we don't have it directly here; use 0 as fallback
      // Overview.tsx should pass cash via props if needed
      const equity = portfolioValue  // approximate; the live portfolio WS has equity_usd

      setTotalEquity(equity || 1)

      const allocationRows: AllocationRow[] = positions.map(p => {
        const kellySizeUsd = parseFloat((kellyFraction * Math.min(equity, MAX_POSITION_USD * 5)).toFixed(2))
        const snap = marketSnapshot?.[p.asset]
        const atr14 = snap?.atr_14 ?? null
        let atrSizeUsd: number | null = null
        if (atr14 && p.current_price > 0) {
          // ATR size: risk 1% of equity per trade, size = riskUsd / (atr / price)
          const riskUsd = equity * 0.01
          const atrPct = atr14 / p.current_price
          atrSizeUsd = parseFloat((riskUsd / atrPct).toFixed(2))
        }
        return {
          asset: p.asset,
          value: p.market_value,
          allocation: portfolioValue > 0 ? (p.market_value / equity) * 100 : 0,
          kellySizeUsd,
          atrSizeUsd,
          currentPrice: p.current_price,
          atr14,
        }
      })

      setRows(allocationRows)
      setCashRow(null) // cash data comes from portfolio WS — not available here
    }
    load().catch(() => {})
  }, [marketSnapshot])

  if (rows.length === 0) return null

  const colors = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444']

  return (
    <div style={{ marginTop: '24px' }}>
      <h3 style={{ marginBottom: '12px' }}>Portfolio Allocation</h3>

      {/* Stacked bar */}
      <div style={{ display: 'flex', height: '28px', borderRadius: '6px', overflow: 'hidden', marginBottom: '16px' }}>
        {rows.map((row, i) => (
          <div
            key={row.asset}
            title={`${row.asset}: ${row.allocation.toFixed(1)}%`}
            style={{
              width: `${row.allocation}%`,
              background: colors[i % colors.length],
              transition: 'width 0.3s ease',
            }}
          />
        ))}
        {cashRow && (
          <div style={{ flex: 1, background: '#374151' }} title={`Cash: ${cashRow.allocation.toFixed(1)}%`} />
        )}
      </div>

      {/* Legend */}
      <div style={{ display: 'flex', gap: '16px', marginBottom: '16px', flexWrap: 'wrap', fontSize: '12px' }}>
        {rows.map((row, i) => (
          <div key={row.asset} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '2px', background: colors[i % colors.length] }} />
            <span>{row.asset}</span>
          </div>
        ))}
      </div>

      {/* Table */}
      <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #374151' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px' }}>Asset</th>
            <th style={{ textAlign: 'right', padding: '4px 8px' }}>Value</th>
            <th style={{ textAlign: 'right', padding: '4px 8px' }}>Allocation</th>
            <th style={{ textAlign: 'right', padding: '4px 8px' }}>Kelly Size</th>
            <th style={{ textAlign: 'right', padding: '4px 8px' }}>ATR Size</th>
            <th style={{ textAlign: 'right', padding: '4px 8px' }}>Signal</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const kelly = row.kellySizeUsd
            const signal = kelly > 0
              ? row.value > kelly * 1.1 ? 'Over' : row.value < kelly * 0.9 ? 'Under' : 'On target'
              : '—'
            const signalColor = signal === 'Over' ? '#f59e0b' : signal === 'Under' ? '#3b82f6' : '#6b7280'
            return (
              <tr key={row.asset} style={{ borderBottom: '1px solid #1f2937' }}>
                <td style={{ padding: '6px 8px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{ width: '8px', height: '8px', borderRadius: '2px', background: colors[i % colors.length] }} />
                  {row.asset}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>${row.value.toFixed(2)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>{row.allocation.toFixed(1)}%</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>${kelly.toFixed(2)}</td>
                <td style={{ padding: '6px 8px', textAlign: 'right' }}>
                  {row.atrSizeUsd != null ? `$${row.atrSizeUsd.toFixed(2)}` : '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', color: signalColor, fontWeight: 600 }}>
                  {signal}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Add AllocationCard to Overview.tsx**

In `Overview.tsx`, add the import:

```tsx
import { AllocationCard } from '../components/AllocationCard'
```

Find where `marketSnapshot` state is stored (it's broadcast via WebSocket as a `market` event). Pass it as a prop to AllocationCard:

```tsx
<AllocationCard marketSnapshot={marketSnapshot} />
```

Place it after the existing portfolio/equity section.

- [ ] **Step 4: Build dashboard**

```bash
cd dashboard && npm run build
```

Expected: build succeeds

- [ ] **Step 5: Commit**

```bash
git add dashboard/src/components/AllocationCard.tsx dashboard/src/pages/Overview.tsx dashboard/src/api.ts
git commit -m "feat: add AllocationCard with stacked bar, Kelly sizing, and ATR size recommendations"
```

---

## Task 15: Clean up — remove duplicated indicator code from poller.ts

Now that all exchange adapters have their own indicator helpers and the engine uses adapters, the indicator functions in `poller.ts` are no longer called by the engine. However, `poller.ts` may still be used by `backtest.ts` and `sentiment.ts`. Check before removing.

**Files:**
- Verify: `agent/src/backtest.ts` and `agent/src/sentiment.ts` imports

- [ ] **Step 1: Check if poller.ts functions are still used**

```bash
cd agent && grep -r "from './poller'" src/
```

If only `backtest.ts` imports from `poller.ts`, keep it. If nothing imports it, remove it.

- [ ] **Step 2: Update poller.ts to re-export from AlpacaAdapter if still needed**

If `backtest.ts` uses `fetchMarketSnapshot`, update the import in `backtest.ts` to use the adapter directly:

```typescript
// backtest.ts — replace:
import { fetchMarketSnapshot } from './poller'
// with:
import { AlpacaAdapter } from './exchanges/alpaca'
```

And pass credentials when creating the adapter in backtest context.

- [ ] **Step 3: Build**

```bash
cd agent && npx tsc --noEmit
```

- [ ] **Step 4: Final commit**

```bash
git add agent/src/
git commit -m "chore: remove duplicate indicator code from poller.ts after adapter migration"
```

---

## Verification

After all tasks complete:

- [ ] Start the agent: `cd agent && npm run dev`
- [ ] Verify rate limiting: send 6 rapid login requests, confirm 429 on the 6th
- [ ] Verify wallet creation with exchange selector works via dashboard
- [ ] Verify paper→live mode toggle requires 2FA and shows red banner
- [ ] Verify Binance/Coinbase wallet can be selected and engine cycles without errors
- [ ] Verify P&L period toggle shows weekly/monthly grouping
- [ ] Verify AllocationCard renders with open positions
