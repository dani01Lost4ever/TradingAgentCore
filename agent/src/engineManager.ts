import { UserModel, WalletModel, TradeModel, type AssetSnapshot } from './schema'
import { runDiscovery } from './discovery'
import { fetchFearAndGreed, fetchNewsHeadlines } from './sentiment'
import { getDecisions, applyBrokerTaxGuardrails, type Decision, type DecisionRuntimeContext } from './brain'
import { getUserConfig, getEffectiveConfigForWallet, type AgentConfig } from './config'
import { getUserKeySet, getAdapterForUser, getActiveWallet } from './keys'
import { getStrategy, mergeWithDefaults } from './strategies/registry'
import { logDecision, markExecuted, markExecutionFailed, resolveOutcomes, supersedePendingManualApprovals } from './logger'
import { getRiskStatus, kellyPositionSize, monitorStopLossTakeProfit, recordEquitySnapshot } from './risk'
import { broadcast } from './ws'
import { logAudit } from './audit'

const MAX_POSITION_USD = parseFloat(process.env.MAX_POSITION_USD || '500')

interface WalletCache {
  portfolio: import('./exchanges/adapter').Portfolio
  market: Record<string, AssetSnapshot>
  cachedAt: number
}

interface UserRuntime {
  userId: string
  username: string
  blocked: boolean
  active: boolean
  lastCycleAt: string | null
  nextCycleAt: string | null
  lastDataRefreshAt: string | null
  nextDataRefreshAt: string | null
  nextOutcomeAt: string | null
  nextRiskCheckAt: string | null
  cycleIntervalMinutes: number | null
  dataIntervalMinutes: number | null
  lastError: string | null
  cycles: number
  recentAssets: string[]
  /** Cache keyed by walletId — evicted on stopRuntime; old entries for prior wallets remain until eviction */
  cachedByWallet: Map<string, WalletCache>
  cycleTimer: NodeJS.Timeout | null
  refreshTimer: NodeJS.Timeout | null
  outcomeTimer: NodeJS.Timeout | null
  riskTimer: NodeJS.Timeout | null
  discoveryTimer: NodeJS.Timeout | null
  cyclesSinceLastDiscovery: number
  role: 'admin' | 'user'
}

function detectRegime(market: Record<string, AssetSnapshot>): string {
  const btc = market['BTC/USD']
  if (!btc?.daily_sma50) return 'Unknown'
  const pctFromSma50 = ((btc.price - btc.daily_sma50) / btc.daily_sma50) * 100
  if (pctFromSma50 > 5) return `Bull Market (BTC +${pctFromSma50.toFixed(1)}% above SMA50)`
  if (pctFromSma50 < -10) return `Bear Market (BTC ${pctFromSma50.toFixed(1)}% below SMA50)`
  return `Sideways (BTC ${(pctFromSma50 >= 0 ? '+' : '')}${pctFromSma50.toFixed(1)}% vs SMA50)`
}

function resolveDecisionStrategy(activeId: string, activeLabel: string, reasoning: string): { id: string; label: string } {
  if (activeId !== 'auto') return { id: activeId, label: activeLabel }
  const match = reasoning.match(/^\[Auto(?:->|→)([^\]]+)\]/i)
  if (!match) return { id: 'auto', label: activeLabel }
  const delegated = match[1].trim()
  return { id: 'auto', label: delegated ? `Auto -> ${delegated}` : activeLabel }
}

function toExchangeSymbol(asset: string): string {
  return asset.replace('/', '')
}

function getHeldNotionalUsd(
  portfolio: import('./exchanges/adapter').Portfolio,
  market: Record<string, AssetSnapshot>,
  asset: string
): number {
  const symbol = toExchangeSymbol(asset)
  const details = portfolio.position_details || []
  const byAsset = details.find((p) => p.asset === asset)
  if (byAsset) return Math.max(0, byAsset.market_value)
  const bySymbol = details.find((p) => p.asset.replace('/', '') === symbol)
  if (bySymbol) return Math.max(0, bySymbol.market_value)

  const qty = portfolio.positions[symbol] || 0
  const px = market[asset]?.price || 0
  return Math.max(0, qty * px)
}

async function runtimeView(rt: UserRuntime) {
  // Collect currently-paused walletIds from Mongo
  const walletDocs = await WalletModel.find({ userId: rt.userId, paused: true }, '_id').lean()
  const pausedWallets = walletDocs.map((w: any) => w._id.toString())
  return {
    userId: rt.userId,
    username: rt.username,
    role: rt.role,
    active: rt.active,
    pausedWallets,
    blocked: rt.blocked,
    cycles: rt.cycles,
    lastCycleAt: rt.lastCycleAt,
    nextCycleAt: rt.nextCycleAt,
    lastDataRefreshAt: rt.lastDataRefreshAt,
    nextDataRefreshAt: rt.nextDataRefreshAt,
    nextOutcomeAt: rt.nextOutcomeAt,
    nextRiskCheckAt: rt.nextRiskCheckAt,
    cycleIntervalMinutes: rt.cycleIntervalMinutes,
    dataIntervalMinutes: rt.dataIntervalMinutes,
    outcomeIntervalMinutes: 60,
    riskIntervalMinutes: 2,
    lastError: rt.lastError,
  }
}

export class EngineManager {
  private runtimes = new Map<string, UserRuntime>()
  private syncTimer: NodeJS.Timeout | null = null

  async start(): Promise<void> {
    await this.syncUsers()
    this.syncTimer = setInterval(() => {
      this.syncUsers().catch((e) => console.error('[engine] syncUsers error:', e.message))
    }, 60_000)
  }

  stopAll(): void {
    for (const rt of this.runtimes.values()) this.stopRuntime(rt)
    if (this.syncTimer) clearInterval(this.syncTimer)
    this.syncTimer = null
  }

  async syncUsers(): Promise<void> {
    const users = await UserModel.find({}, '_id username role blocked').lean()
    const seen = new Set<string>()
    for (const u of users) {
      const userId = u._id.toString()
      seen.add(userId)
      if (!this.runtimes.has(userId)) {
        await this.startForUser(
          userId,
          u.username,
          (u as any).role === 'admin' ? 'admin' : 'user',
          Boolean((u as any).blocked),
        )
      } else {
        const rt = this.runtimes.get(userId)!
        rt.username = u.username
        rt.role = (u as any).role === 'admin' ? 'admin' : 'user'
        rt.blocked = Boolean((u as any).blocked)
        // NOTE: do NOT auto-flip wallet pause state here. Pause must only change via
        // pauseWallet/resumeWallet (for users) or setBlocked→pause all wallets (for admins).
      }
    }
    for (const [userId, rt] of this.runtimes.entries()) {
      if (!seen.has(userId)) this.stopRuntime(rt)
    }
  }

  async ensureUser(userId: string): Promise<void> {
    if (this.runtimes.has(userId)) return
    const user = await UserModel.findById(userId).lean()
    if (!user) return
    await this.startForUser(userId, user.username, user.role === 'admin' ? 'admin' : 'user', Boolean((user as any).blocked))
  }

  async list(): Promise<any[]> {
    return Promise.all([...this.runtimes.values()].map(runtimeView))
  }

  async get(userId: string): Promise<any | null> {
    const rt = this.runtimes.get(userId)
    return rt ? runtimeView(rt) : null
  }

  /**
   * Pause the active wallet for a user, persisting to Mongo.
   * Pause must NEVER be flipped to false by anything other than resumeWallet.
   */
  async pauseWallet(userId: string, walletId: string, reason?: string): Promise<boolean> {
    const wallet = await WalletModel.findOne({ _id: walletId, userId })
    if (!wallet) return false
    wallet.paused = true
    wallet.pausedAt = new Date()
    wallet.pausedReason = reason || null
    await wallet.save()
    return true
  }

  /**
   * Resume a wallet — the only place where paused is set to false.
   */
  async resumeWallet(userId: string, walletId: string): Promise<boolean> {
    const rt = this.runtimes.get(userId)
    if (rt?.blocked) return false
    const wallet = await WalletModel.findOne({ _id: walletId, userId })
    if (!wallet) return false
    wallet.paused = false
    wallet.pausedAt = null
    wallet.pausedReason = null
    await wallet.save()
    await logAudit('wallet.resume', `Wallet ${walletId} resumed`, userId)
    return true
  }

  async triggerCycle(userId: string): Promise<boolean> {
    const rt = this.runtimes.get(userId)
    if (!rt) return false
    await this.runCycle(rt)
    return true
  }

  private stopRuntime(rt: UserRuntime): void {
    rt.active = false
    if (rt.cycleTimer) clearTimeout(rt.cycleTimer)
    if (rt.refreshTimer) clearTimeout(rt.refreshTimer)
    if (rt.outcomeTimer) clearTimeout(rt.outcomeTimer)
    if (rt.riskTimer) clearTimeout(rt.riskTimer)
    if (rt.discoveryTimer) clearTimeout(rt.discoveryTimer)
    // Evict all cache entries for this user
    rt.cachedByWallet.clear()
    this.runtimes.delete(rt.userId)
  }

  /**
   * setBlocked — when blocking, persist pause=true on ALL wallets.
   * When unblocking, do NOT auto-resume any wallet; admin must explicitly resumeWallet.
   */
  async setBlocked(userId: string, blocked: boolean): Promise<boolean> {
    const rt = this.runtimes.get(userId)
    if (!rt) return false
    rt.blocked = blocked
    if (blocked) {
      // Persist pause=true on every wallet for this user
      await WalletModel.updateMany(
        { userId },
        { paused: true, pausedAt: new Date(), pausedReason: 'Account blocked by admin' },
      )
    }
    // When unblocking: wallets remain paused until explicit resumeWallet
    return true
  }

  /**
   * notifyWalletSwitch — called by api.ts after activateUserWallet succeeds.
   * 1. Evicts cache for the wallet that was previously active (we don't know its id,
   *    so we wipe the entire map — simple and safe for v1).
   * 2. Broadcasts wallet:switched so all tabs see the new wallet immediately.
   * 3. Fires an immediate runCycle (fire-and-forget).
   */
  notifyWalletSwitch(userId: string, walletId: string): void {
    const rt = this.runtimes.get(userId)
    if (!rt) return
    // Evict cache for previous active wallet entries (simple: clear all; they'll be refilled on demand)
    rt.cachedByWallet.clear()
    broadcast('wallet:switched', { walletId }, userId)
    this.runCycle(rt).catch((e) => console.error(`[engine:${rt.username}] notifyWalletSwitch cycle error:`, e.message))
  }

  private async startForUser(userId: string, username: string, role: 'admin' | 'user', blocked: boolean): Promise<void> {
    const rt: UserRuntime = {
      userId, username, role, blocked, active: true,
      lastCycleAt: null, nextCycleAt: null, lastError: null, cycles: 0,
      lastDataRefreshAt: null, nextDataRefreshAt: null, nextOutcomeAt: null, nextRiskCheckAt: null,
      cycleIntervalMinutes: null, dataIntervalMinutes: null,
      recentAssets: [], cachedByWallet: new Map(),
      cycleTimer: null, refreshTimer: null, outcomeTimer: null, riskTimer: null,
      discoveryTimer: null, cyclesSinceLastDiscovery: 0,
    }
    this.runtimes.set(userId, rt)
    await this.runCycle(rt).catch((e) => console.error(`[engine:${username}] bootstrap cycle error:`, e.message))
    this.scheduleCycle(rt)
    this.scheduleDataRefresh(rt)
    this.scheduleOutcomeResolution(rt)
    this.scheduleRiskMonitor(rt)
    this.scheduleDiscovery(rt)
  }

  private scheduleCycle(rt: UserRuntime): void {
    if (!rt.active) return
    const schedule = async () => {
      if (!rt.active) return
      const activeWallet = await getActiveWallet(rt.userId)
      const walletId = activeWallet?._id?.toString()
      const cfg = await getEffectiveConfigForWallet(rt.userId, walletId)
      const mins = (cfg.activeStrategy === 'llm' || (cfg.activeStrategy === 'auto' && cfg.autoFallbackToLlm))
        ? cfg.cycleMinutes
        : cfg.marketDataMinutes
      rt.cycleIntervalMinutes = mins
      rt.nextCycleAt = new Date(Date.now() + mins * 60_000).toISOString()
      rt.cycleTimer = setTimeout(async () => {
        await this.runCycle(rt).catch((e) => console.error(`[engine:${rt.username}] cycle error:`, e.message))
        schedule()
      }, mins * 60_000)
    }
    schedule().catch((e) => console.error(`[engine:${rt.username}] scheduleCycle error:`, e.message))
  }

  private rescheduleCycle(rt: UserRuntime): void {
    if (rt.cycleTimer) clearTimeout(rt.cycleTimer)
    rt.cycleTimer = null
    this.scheduleCycle(rt)
  }

  private scheduleDataRefresh(rt: UserRuntime): void {
    if (!rt.active) return
    const schedule = async () => {
      if (!rt.active) return
      const activeWallet = await getActiveWallet(rt.userId)
      const walletId = activeWallet?._id?.toString()
      const cfg = await getEffectiveConfigForWallet(rt.userId, walletId)
      rt.dataIntervalMinutes = cfg.marketDataMinutes
      rt.nextDataRefreshAt = new Date(Date.now() + cfg.marketDataMinutes * 60_000).toISOString()
      rt.refreshTimer = setTimeout(async () => {
        try {
          if (cfg.activeStrategy === 'llm' || (cfg.activeStrategy === 'auto' && cfg.autoFallbackToLlm)) {
            await this.refreshMarketData(rt, cfg, true)
            this.rescheduleCycle(rt)
          }
        } catch (e: any) {
          console.error(`[engine:${rt.username}] data refresh error:`, e.message)
        }
        schedule()
      }, cfg.marketDataMinutes * 60_000)
    }
    schedule().catch((e) => console.error(`[engine:${rt.username}] scheduleDataRefresh error:`, e.message))
  }

  private scheduleOutcomeResolution(rt: UserRuntime): void {
    if (!rt.active) return
    const loop = async () => {
      rt.nextOutcomeAt = new Date(Date.now() + 60 * 60_000).toISOString()
      rt.outcomeTimer = setTimeout(async () => {
        try {
          const keys = await getUserKeySet(rt.userId)
          await resolveOutcomes(rt.userId, {
            alpaca_api_key: keys.alpaca_api_key,
            alpaca_api_secret: keys.alpaca_api_secret,
            alpaca_base_url: keys.alpaca_base_url,
          })
        } catch (e: any) {
          console.error(`[engine:${rt.username}] outcome resolution error:`, e.message)
        }
        loop()
      }, 60 * 60_000)
    }
    loop()
  }

  private scheduleRiskMonitor(rt: UserRuntime): void {
    if (!rt.active) return
    const loop = async () => {
      rt.nextRiskCheckAt = new Date(Date.now() + 2 * 60_000).toISOString()
      rt.riskTimer = setTimeout(async () => {
        try {
          const activeWallet = await getActiveWallet(rt.userId)
          const walletId = activeWallet?._id?.toString()
          const [cfg, adapter] = await Promise.all([getEffectiveConfigForWallet(rt.userId, walletId), getAdapterForUser(rt.userId)])
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

  /**
   * triggerDiscovery — runs an immediate discovery for the given wallet.
   */
  async triggerDiscovery(userId: string, walletId: string): Promise<import('./schema').DiscoveryRunDoc | null> {
    try {
      const cfg = await getEffectiveConfigForWallet(userId, walletId)
      return await runDiscovery(userId, walletId, cfg.tradingMode)
    } catch (e: any) {
      console.error(`[engine] triggerDiscovery error:`, e.message)
      return null
    }
  }

  private scheduleDiscovery(rt: UserRuntime): void {
    if (!rt.active) return
    const loop = async () => {
      if (!rt.active) return
      const activeWallet = await getActiveWallet(rt.userId)
      if (!activeWallet) return
      const walletId = activeWallet._id?.toString()
      if (!walletId) return
      const cfg = await getEffectiveConfigForWallet(rt.userId, walletId)
      const tradingMode = cfg.tradingMode

      // Cadence: long_term = 1×/day (1440min), swing = every 2 cycles, scalp = every 4 cycles
      // We implement via a time-based interval
      const intervalMs = tradingMode === 'long_term'
        ? 24 * 60 * 60_000        // 1× per day
        : tradingMode === 'swing'
          ? 2 * cfg.cycleMinutes * 60_000   // every 2 cycles
          : 4 * cfg.cycleMinutes * 60_000   // every 4 cycles (scalp)

      rt.discoveryTimer = setTimeout(async () => {
        try {
          if (rt.active && !activeWallet.paused) {
            await runDiscovery(rt.userId, walletId, tradingMode)
          }
        } catch (e: any) {
          console.error(`[engine:${rt.username}] discovery error:`, e.message)
        }
        loop()
      }, intervalMs)
    }
    loop().catch((e) => console.error(`[engine:${rt.username}] scheduleDiscovery error:`, e.message))
  }

  private async refreshMarketData(
    rt: UserRuntime,
    cfg: AgentConfig,
    force = false,
    walletId?: string
  ): Promise<{ portfolio: import('./exchanges/adapter').Portfolio; market: Record<string, AssetSnapshot> }> {
    const cacheMaxAgeMs = Math.max(15_000, cfg.marketDataMinutes * 60 * 1000 - 5_000)
    const cacheKey = walletId || '__default__'
    const cached = rt.cachedByWallet.get(cacheKey)
    const cacheFresh = !force && cached && (Date.now() - cached.cachedAt) < cacheMaxAgeMs
    if (cacheFresh) return { portfolio: cached!.portfolio, market: cached!.market }

    const adapter = await getAdapterForUser(rt.userId)
    const [portfolio, market] = await Promise.all([
      adapter.fetchPortfolio(),
      adapter.fetchMarketSnapshot(cfg.assets),
    ])
    rt.cachedByWallet.set(cacheKey, { portfolio, market, cachedAt: Date.now() })
    rt.lastDataRefreshAt = new Date().toISOString()
    broadcast('portfolio', { cash: portfolio.cash_usd, equity: portfolio.equity_usd }, rt.userId)
    return { portfolio, market }
  }

  /**
   * Apply broker-fee + tax guardrails to a decision list.
   * Both the LLM branch (via getDecisions) and the rule-based branch call this
   * so cost enforcement is DRY and consistent regardless of strategy type.
   */
  private applyWalletCostGuardrails(
    decisions: Decision[],
    costConfig: DecisionRuntimeContext['costConfig'],
  ): Decision[] {
    return applyBrokerTaxGuardrails(decisions, costConfig)
  }

  private async runCycle(rt: UserRuntime): Promise<void> {
    if (!rt.active || rt.blocked) return

    // Read pause state from Mongo (persisted; survives restart)
    const activeWallet = await getActiveWallet(rt.userId)
    if (!activeWallet) return
    if (activeWallet.paused) return  // Safety: paused wallets never execute

    // Live-trading hard gate: even if mode is 'live', the user must have explicitly
    // opted in by toggling liveTrading=true. This is a defense-in-depth check on top
    // of wallet.mode. Default state is liveTrading=false, so a fresh wallet cannot
    // trade real money even if mode was somehow set to 'live'.
    if ((activeWallet as any).mode === 'live' && !(activeWallet as any).liveTrading) {
      console.warn(`[engine:${rt.username}] wallet ${activeWallet._id?.toString()} mode=live but liveTrading gate is false — skipping cycle`)
      return
    }

    const walletId = activeWallet._id?.toString()
    const cfg = await getEffectiveConfigForWallet(rt.userId, walletId)

    // Build cost config from wallet doc so guardrails fire in automated cycles (Fix #3)
    const walletCostConfig: import('./brain').DecisionRuntimeContext['costConfig'] = {
      feeModel: {
        kind:   (activeWallet as any).feeModel?.kind   ?? 'percent',
        value:  (activeWallet as any).feeModel?.value  ?? 0,
        minFee: (activeWallet as any).feeModel?.minFee ?? 0,
      },
      taxRatePct:      (activeWallet as any).taxRatePct      ?? 26,
      minNetProfitPct: (activeWallet as any).minNetProfitPct ?? 0.5,
    }

    const [keys, adapter] = await Promise.all([getUserKeySet(rt.userId), getAdapterForUser(rt.userId)])
    try {
      const { portfolio, market } = await this.refreshMarketData(rt, cfg, false, walletId)
      const riskStatus = await getRiskStatus(cfg as any, portfolio.equity_usd, rt.userId)
      if (riskStatus.circuitBreakerActive) {
        await recordEquitySnapshot(portfolio, rt.userId, walletId)
        return
      }

      const [fearGreed, news] = await Promise.all([
        fetchFearAndGreed(),
        fetchNewsHeadlines(cfg.assets, { alpaca_api_key: keys.alpaca_api_key, alpaca_api_secret: keys.alpaca_api_secret, alpaca_base_url: keys.alpaca_base_url }),
      ])

      const regime = detectRegime(market)
      const activeStrategyId = cfg.activeStrategy || 'llm'
      const strategy = getStrategy(activeStrategyId)
      const resolvedParams = mergeWithDefaults(strategy.params, (cfg.strategyParams?.[cfg.activeStrategy] as any) ?? {})

      let decisions: Decision[] = []
      if ((cfg.activeStrategy || 'llm') === 'llm') {
        decisions = await getDecisions(
          market, portfolio, MAX_POSITION_USD, rt.recentAssets, fearGreed, news, regime,
          {
            userId: rt.userId,
            walletId,
            config: cfg,
            keys: { anthropic_api_key: keys.anthropic_api_key, openai_api_key: keys.openai_api_key },
            costConfig: walletCostConfig,
          },
        )
      } else {
        const stratResults = await Promise.all(
          Object.entries(market).map(async ([asset, snapshot]) => {
            const result = await strategy.evaluate({
              asset, snapshot, portfolio, maxPositionUsd: MAX_POSITION_USD, regime, fearGreedValue: fearGreed?.value ?? null,
            }, resolvedParams)
            return { asset, result }
          })
        )
        const rawDecisions: Decision[] = stratResults.filter(({ result }) => result.signal !== 'none').map(({ asset, result }) => ({
          action: result.action, asset, amount_usd: result.amount_usd, confidence: result.confidence, reasoning: result.reasoning,
        }))
        // Apply broker-fee + tax guardrails to rule-based decisions (Fix #8)
        decisions = this.applyWalletCostGuardrails(rawDecisions, walletCostConfig)
      }

      // ── maxTradesPerDay enforcement ─────────────────────────────────────────
      const effectiveCfg = cfg as import('./config').EffectiveConfig
      let todayTradeCount = 0
      if (effectiveCfg.maxTradesPerDay > 0) {
        const startOfDayUTC = new Date()
        startOfDayUTC.setUTCHours(0, 0, 0, 0)
        todayTradeCount = await TradeModel.countDocuments({
          userId: rt.userId,
          walletId,
          executed: true,
          timestamp: { $gte: startOfDayUTC },
          'decision.action': { $ne: 'hold' },
        })
      }

      // ── minHoldingMinutes enforcement (for SELL decisions) ─────────────────
      // Build map of asset -> last BUY timestamp for open positions
      const lastBuyByAsset: Map<string, Date> = new Map()
      if (effectiveCfg.minHoldingMinutes > 0) {
        const openBuys = await TradeModel.find({
          userId: rt.userId,
          walletId,
          executed: true,
          outcome: { $exists: false },
          'decision.action': 'buy',
        }).sort({ timestamp: -1 }).lean()
        for (const trade of openBuys) {
          const asset = trade.decision.asset
          if (!lastBuyByAsset.has(asset)) {
            lastBuyByAsset.set(asset, new Date(trade.timestamp))
          }
        }
      }

      const normalized: Decision[] = []
      for (const original of decisions) {
        let decision = { ...original }
        if (cfg.confidenceThreshold > 0 && decision.action !== 'hold' && decision.confidence < cfg.confidenceThreshold) {
          decision = { ...decision, action: 'hold', amount_usd: 0 }
        }
        if (cfg.kellyEnabled && decision.action === 'buy') {
          decision.amount_usd = await kellyPositionSize(decision.asset, decision.amount_usd, MAX_POSITION_USD, rt.userId)
        }
        // Enforce maxTradesPerDay
        if (effectiveCfg.maxTradesPerDay > 0 && decision.action !== 'hold' && todayTradeCount >= effectiveCfg.maxTradesPerDay) {
          decision = { ...decision, action: 'hold', amount_usd: 0, reasoning: `maxTradesPerDay (${effectiveCfg.maxTradesPerDay}) reached for this wallet` }
        }
        // Enforce minHoldingMinutes for SELL decisions
        if (decision.action === 'sell' && effectiveCfg.minHoldingMinutes > 0) {
          const buyTs = lastBuyByAsset.get(decision.asset)
          if (buyTs) {
            const heldMinutes = (Date.now() - buyTs.getTime()) / 60_000
            if (heldMinutes < effectiveCfg.minHoldingMinutes) {
              decision = { ...decision, action: 'hold', amount_usd: 0, reasoning: `minHoldingMinutes (${effectiveCfg.minHoldingMinutes}) not met — held ${Math.floor(heldMinutes)}min` }
            }
          }
        }
        normalized.push(decision)
      }

      const actionable = normalized.filter(d => d.action !== 'hold')
      const sells = actionable
        .filter(d => d.action === 'sell')
        .sort((a, b) => b.confidence - a.confidence)
      const buys = actionable
        .filter(d => d.action === 'buy')
        .sort((a, b) => b.confidence - a.confidence)

      const openSymbols = new Set(
        Object.entries(portfolio.positions)
          .filter(([, qty]) => qty > 0)
          .map(([symbol]) => symbol)
      )
      let remainingSlots = Math.max(0, cfg.maxOpenPositions - openSymbols.size)

      const selected: Decision[] = []

      for (const sell of sells) {
        const heldNotional = getHeldNotionalUsd(portfolio, market, sell.asset)
        if (heldNotional <= 0) continue

        const amount = Math.min(Math.max(sell.amount_usd, 0), heldNotional)
        if (amount <= 0) continue
        selected.push({ ...sell, amount_usd: amount })

        if (amount >= heldNotional * 0.98) {
          const symbol = toExchangeSymbol(sell.asset)
          if (openSymbols.delete(symbol)) remainingSlots += 1
        }
      }

      for (const buy of buys) {
        const symbol = toExchangeSymbol(buy.asset)
        const alreadyHeld = openSymbols.has(symbol)
        if (!alreadyHeld && remainingSlots <= 0) continue
        if (buy.amount_usd <= 0) continue

        selected.push({ ...buy })
        if (!alreadyHeld) {
          openSymbols.add(symbol)
          remainingSlots -= 1
        }
      }

      const fallback = normalized[0]
      const candidateDecisions = selected.length
        ? selected
        : (fallback ? [fallback] : [])
      if (!candidateDecisions.length) return

      const finalDecisions: Decision[] = candidateDecisions.map((decision): Decision => {
        if (decision.action !== 'sell') return decision
        const heldNotional = getHeldNotionalUsd(portfolio, market, decision.asset)
        if (heldNotional <= 0) {
          return { ...decision, action: 'hold', amount_usd: 0, reasoning: 'No position to sell on this wallet' } as Decision
        }
        return { ...decision, amount_usd: Math.min(decision.amount_usd, heldNotional) } as Decision
      })

      if (!cfg.autoApprove && finalDecisions.some(d => d.action !== 'hold')) {
        await supersedePendingManualApprovals(rt.userId, 'Superseded by newer signal')
      }

      for (const decision of finalDecisions) {
        const decisionStrategy = resolveDecisionStrategy(activeStrategyId, strategy.label, decision.reasoning)
        const record = await logDecision(market, portfolio, decision, rt.userId, {
          approved: cfg.autoApprove,
          approval_mode: cfg.autoApprove ? 'auto' : 'manual',
          strategy_id: decisionStrategy.id,
          strategy_label: decisionStrategy.label,
          walletId,
        })
        broadcast('trade:new', record.toObject(), rt.userId)

        if (decision.action !== 'hold') {
          rt.recentAssets = [decision.asset, ...rt.recentAssets].slice(0, 3)
          if (cfg.autoApprove) {
            try {
              const result = await adapter.executeOrder(decision)
              await markExecuted(record._id.toString(), result.order_id)
              const executedRecord = await TradeModel.findById(record._id).lean()
              broadcast('trade:executed', executedRecord, rt.userId)
            } catch (err: any) {
              await markExecutionFailed(record._id.toString(), err.message)
              const failedRecord = await TradeModel.findById(record._id).lean()
              if (failedRecord) broadcast('trade:executed', failedRecord, rt.userId)
            }
          }
        }
      }
      await recordEquitySnapshot(portfolio, rt.userId, walletId)
      rt.cycles += 1
      rt.lastCycleAt = new Date().toISOString()
      rt.lastError = null
    } catch (err: any) {
      rt.lastError = err.message
      console.error(`[engine:${rt.username}] runCycle failed:`, err.message)
    }
  }
}

export const engineManager = new EngineManager()
