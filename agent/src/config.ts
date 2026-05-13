import { ConfigModel, WalletModel } from './schema'

export type TradingMode = 'scalp' | 'swing' | 'long_term'

export const tradingModeDefaults: Record<TradingMode, {
  cycleMinutes: number
  assets: string[]
  stopLossPct: number
  takeProfitPct: number
  maxOpenPositions: number
  maxTradesPerDay: number
  minHoldingMinutes: number
  promptHint: string
}> = {
  scalp: {
    cycleMinutes: 15,
    assets: ['BTC/USD', 'ETH/USD', 'SOL/USD'],
    stopLossPct: 2,
    takeProfitPct: 4,
    maxOpenPositions: 3,
    maxTradesPerDay: 20,
    minHoldingMinutes: 0,
    promptHint: 'MODE GUIDANCE (scalp): trade short-term moves on crypto majors. Lean on RSI extremes, MACD hist sign changes, and BB %B excursions. Take positions at moderate confidence (0.4-0.65) — turnover absorbs occasional misses. Tight stops, quick exits.',
  },
  swing: {
    cycleMinutes: 120,
    assets: ['BTC/USD', 'ETH/USD'],
    stopLossPct: 5,
    takeProfitPct: 10,
    maxOpenPositions: 4,
    maxTradesPerDay: 6,
    minHoldingMinutes: 240,
    promptHint: 'MODE GUIDANCE (swing): hold positions for hours to a few days. Take a position when at least 2 of {RSI, EMA9/21 cross, MACD hist, BB %B} align with the regime. Moderate-to-high confidence (0.5-0.8) is the working range. Hold only when signals are truly mixed.',
  },
  long_term: {
    cycleMinutes: 720,
    assets: ['SPY', 'VOO', 'QQQ', 'AAPL', 'MSFT'],
    stopLossPct: 15,
    takeProfitPct: 30,
    maxOpenPositions: 6,
    maxTradesPerDay: 2,
    minHoldingMinutes: 4320,
    promptHint: 'MODE GUIDANCE (long_term): you manage a long-horizon portfolio on stocks/ETFs and major crypto. Make 1-2 decisive moves per day. When you see a clean technical setup on a quality name (e.g. RSI 45-65 AND EMA9>EMA21 AND price above SMA50 AND healthy volume) take a position at moderate-to-high confidence (0.55-0.75) — do NOT wait for perfection. You hold for days/weeks, so small entry-timing imperfections do not matter. Earnings/news catalysts are a plus but NOT required — you cannot see the earnings calendar; use technicals + sector regime as the primary signal.',
  },
}

export interface EffectiveConfig extends AgentConfig {
  tradingMode: TradingMode
  minHoldingMinutes: number
  maxTradesPerDay: number
}

export async function getEffectiveConfigForWallet(
  userId: string,
  walletId: string | undefined
): Promise<EffectiveConfig> {
  const base = await getUserConfig(userId)

  // Determine trading mode (wallet wins if set, else default to swing)
  let tradingMode: TradingMode = 'swing'
  let walletCycleMinutes = 0
  let walletAssets: string[] = []
  let walletMaxTradesPerDay = 0
  let walletMinHoldingMinutes = 0

  if (walletId) {
    const wallet = await WalletModel.findById(walletId).lean()
    if (wallet) {
      tradingMode = (wallet.tradingMode as TradingMode) || 'swing'
      walletCycleMinutes = wallet.cycleMinutes ?? 0
      walletAssets = wallet.assets ?? []
      walletMaxTradesPerDay = wallet.maxTradesPerDay ?? 0
      walletMinHoldingMinutes = wallet.minHoldingMinutes ?? 0
    }
  }

  const modeDefaults = tradingModeDefaults[tradingMode]

  // Merge order:
  // 1. Start from user's global config (base)
  // 2. Apply mode defaults for mode-specific fields
  // 3. Wallet-specific non-zero/non-empty values override
  const merged: EffectiveConfig = {
    ...base,
    tradingMode,
    // cycleMinutes: wallet explicit > mode default > global config
    cycleMinutes: walletCycleMinutes > 0
      ? walletCycleMinutes
      : modeDefaults.cycleMinutes,
    // assets: wallet explicit > mode default (global config assets NOT used for mode trading)
    assets: walletAssets.length > 0
      ? walletAssets
      : modeDefaults.assets,
    // stopLossPct/takeProfitPct/maxOpenPositions: mode defaults win over global (unless global explicitly set)
    stopLossPct: modeDefaults.stopLossPct,
    takeProfitPct: modeDefaults.takeProfitPct,
    maxOpenPositions: modeDefaults.maxOpenPositions,
    // maxTradesPerDay: wallet explicit > mode default
    maxTradesPerDay: walletMaxTradesPerDay > 0
      ? walletMaxTradesPerDay
      : modeDefaults.maxTradesPerDay,
    // minHoldingMinutes: wallet explicit > mode default
    minHoldingMinutes: walletMinHoldingMinutes > 0
      ? walletMinHoldingMinutes
      : modeDefaults.minHoldingMinutes,
  }

  return merged
}

export interface AgentConfig {
  autoApprove: boolean
  assets: string[]
  stopLossPct: number
  takeProfitPct: number
  maxDrawdownPct: number
  maxOpenPositions: number
  claudeModel: string
  cycleMinutes: number
  marketDataMinutes: number
  confidenceThreshold: number
  kellyEnabled: boolean
  consensusMode: boolean
  consensusModel: string
  costAwareTrading: boolean
  costLookbackCalls: number
  costProfitRatio: number
  trailingStopEnabled: boolean
  trailingStopPct: number
  activeStrategy: string
  strategyParams: Record<string, Record<string, number | boolean | string>>
  autoFallbackToLlm: boolean
}

const defaultAssets = (process.env.ASSETS || 'BTC/USD,ETH/USD')
  .split(',')
  .map(a => a.trim())
  .filter(Boolean)
const GLOBAL_SCOPE = '__global__'

async function normalizeLegacyGlobalConfigs(): Promise<void> {
  const legacyDocs = await ConfigModel.find({ $or: [{ userId: null }, { userId: { $exists: false } }] }).lean()
  for (const doc of legacyDocs) {
    const key = (doc as any).key || 'agent'
    const hasGlobal = await ConfigModel.exists({ _id: { $ne: (doc as any)._id }, key, userId: GLOBAL_SCOPE })
    if (hasGlobal) {
      await ConfigModel.deleteOne({ _id: (doc as any)._id })
      continue
    }
    await ConfigModel.updateOne({ _id: (doc as any)._id }, { $set: { userId: GLOBAL_SCOPE } })
  }
}

async function dedupePerUserConfigKeys(): Promise<void> {
  const duplicates = await ConfigModel.aggregate([
    {
      $group: {
        _id: { key: '$key', userId: '$userId' },
        ids: { $push: '$_id' },
        count: { $sum: 1 },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ])

  for (const dup of duplicates) {
    const ids = (dup.ids as any[]).map((id) => id.toString())
    const keep = ids[ids.length - 1]
    const drop = ids.filter((id) => id !== keep)
    if (drop.length) {
      await ConfigModel.deleteMany({ _id: { $in: drop } as any })
    }
  }
}

async function migrateConfigIndexes(): Promise<void> {
  const indexes = await ConfigModel.collection.indexes()
  const legacyKeyIndex = indexes.find((idx: any) => {
    const key = idx?.key || {}
    return idx?.name === 'key_1' && idx?.unique === true && key.key === 1 && Object.keys(key).length === 1
  })
  if (legacyKeyIndex) {
    await ConfigModel.collection.dropIndex(String(legacyKeyIndex.name))
    console.log('[config] Dropped legacy unique index configs.key_1')
  }
  await ConfigModel.collection.createIndex({ key: 1, userId: 1 }, { unique: true, name: 'key_1_userId_1' })
}

function createDefaults(): AgentConfig {
  return {
    autoApprove: false,
    assets: defaultAssets,
    stopLossPct: 5,
    takeProfitPct: 10,
    maxDrawdownPct: 10,
    maxOpenPositions: 3,
    claudeModel: process.env.CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
    cycleMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES || '30'),
    marketDataMinutes: parseInt(process.env.MARKET_DATA_INTERVAL_MINUTES || '5'),
    confidenceThreshold: 0,
    kellyEnabled: false,
    consensusMode: false,
    consensusModel: '',
    costAwareTrading: true,
    costLookbackCalls: 20,
    costProfitRatio: 1,
    trailingStopEnabled: false,
    trailingStopPct: 2.5,
    activeStrategy: 'llm',
    strategyParams: {},
    autoFallbackToLlm: false,
  }
}

function applyDocToConfig(target: AgentConfig, saved: any): AgentConfig {
  target.autoApprove = saved.autoApprove ?? target.autoApprove
  target.assets = saved.assets?.length ? saved.assets : target.assets
  if (typeof saved.stopLossPct === 'number') target.stopLossPct = saved.stopLossPct
  if (typeof saved.takeProfitPct === 'number') target.takeProfitPct = saved.takeProfitPct
  if (typeof saved.maxDrawdownPct === 'number') target.maxDrawdownPct = saved.maxDrawdownPct
  if (typeof saved.maxOpenPositions === 'number') target.maxOpenPositions = saved.maxOpenPositions
  if (typeof saved.claudeModel === 'string') target.claudeModel = saved.claudeModel
  if (typeof saved.cycleMinutes === 'number') target.cycleMinutes = saved.cycleMinutes
  if (typeof saved.marketDataMinutes === 'number') target.marketDataMinutes = saved.marketDataMinutes
  if (typeof saved.confidenceThreshold === 'number') target.confidenceThreshold = saved.confidenceThreshold
  if (typeof saved.kellyEnabled === 'boolean') target.kellyEnabled = saved.kellyEnabled
  if (typeof saved.consensusMode === 'boolean') target.consensusMode = saved.consensusMode
  if (typeof saved.consensusModel === 'string') target.consensusModel = saved.consensusModel
  if (typeof saved.costAwareTrading === 'boolean') target.costAwareTrading = saved.costAwareTrading
  if (typeof saved.costLookbackCalls === 'number') target.costLookbackCalls = saved.costLookbackCalls
  if (typeof saved.costProfitRatio === 'number') target.costProfitRatio = saved.costProfitRatio
  if (typeof saved.trailingStopEnabled === 'boolean') target.trailingStopEnabled = saved.trailingStopEnabled
  if (typeof saved.trailingStopPct === 'number') target.trailingStopPct = saved.trailingStopPct
  if (typeof saved.activeStrategy === 'string') target.activeStrategy = saved.activeStrategy
  if (saved.strategyParams && typeof saved.strategyParams === 'object') target.strategyParams = saved.strategyParams
  if (typeof saved.autoFallbackToLlm === 'boolean') target.autoFallbackToLlm = saved.autoFallbackToLlm
  return target
}

function sanitizeUpdates(updates: Partial<AgentConfig>): Partial<AgentConfig> {
  const allowed: (keyof AgentConfig)[] = [
    'autoApprove', 'assets', 'stopLossPct', 'takeProfitPct', 'maxDrawdownPct',
    'maxOpenPositions', 'claudeModel', 'cycleMinutes', 'marketDataMinutes',
    'confidenceThreshold', 'kellyEnabled', 'consensusMode', 'consensusModel',
    'costAwareTrading', 'costLookbackCalls', 'costProfitRatio',
    'trailingStopEnabled', 'trailingStopPct',
    'activeStrategy', 'strategyParams', 'autoFallbackToLlm',
  ]
  const out: Partial<AgentConfig> = {}
  for (const key of allowed) {
    if (updates[key] !== undefined) (out as any)[key] = updates[key]
  }
  return out
}

const state: AgentConfig = createDefaults()

export function getConfig(): Readonly<AgentConfig> {
  return state
}

export async function setConfig(updates: Partial<AgentConfig>): Promise<AgentConfig> {
  const sanitized = sanitizeUpdates(updates)
  Object.assign(state, sanitized)
  await ConfigModel.findOneAndUpdate(
    { key: 'agent', userId: GLOBAL_SCOPE },
    { $set: sanitized },
    { upsert: true, returnDocument: 'after' }
  )
  return state
}

export async function initConfig(): Promise<void> {
  await normalizeLegacyGlobalConfigs()
  await dedupePerUserConfigKeys()
  await migrateConfigIndexes()
  const saved = await ConfigModel.findOne({ key: 'agent', userId: { $in: [GLOBAL_SCOPE, null] } }).lean()
  if (saved) {
    applyDocToConfig(state, saved)
    console.log(`[config] Loaded global config from DB - model: ${state.claudeModel}, cycle: ${state.cycleMinutes}min, autoApprove: ${state.autoApprove}`)
  } else {
    await ConfigModel.create({ key: 'agent', userId: GLOBAL_SCOPE, ...state })
    console.log('[config] Initialized global defaults in DB')
  }
}

export async function getUserConfig(userId: string): Promise<AgentConfig> {
  const base = createDefaults()
  const saved = await ConfigModel.findOne({ key: 'agent', userId }).lean()
  if (saved) return applyDocToConfig(base, saved)
  return base
}

export async function setUserConfig(userId: string, updates: Partial<AgentConfig>): Promise<AgentConfig> {
  const current = await getUserConfig(userId)
  const sanitized = sanitizeUpdates(updates)
  Object.assign(current, sanitized)
  await ConfigModel.findOneAndUpdate(
    { key: 'agent', userId },
    { $set: { ...sanitized, key: 'agent', userId } },
    { upsert: true, returnDocument: 'after' }
  )
  return current
}
