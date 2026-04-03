import { ConfigModel } from './schema'

export interface AgentConfig {
  autoApprove: boolean
  assets: string[]
  stopLossPct: number
  takeProfitPct: number
  maxDrawdownPct: number
  maxOpenPositions: number
  claudeModel: string     // LLM model to use
  cycleMinutes: number    // How often to run the trading cycle
}

const defaultAssets = (process.env.ASSETS || 'BTC/USD,ETH/USD')
  .split(',')
  .map(a => a.trim())
  .filter(Boolean)

// In-memory cache — fast reads, DB is source of truth
const state: AgentConfig = {
  autoApprove: false,
  assets: defaultAssets,
  stopLossPct: 5,
  takeProfitPct: 10,
  maxDrawdownPct: 10,
  maxOpenPositions: 3,
  claudeModel: process.env.CLAUDE_MODEL || 'claude-3-5-haiku-20241022',
  cycleMinutes: parseInt(process.env.POLL_INTERVAL_MINUTES || '30'),
}

export function getConfig(): Readonly<AgentConfig> {
  return state
}

export async function setConfig(updates: Partial<AgentConfig>): Promise<AgentConfig> {
  Object.assign(state, updates)
  await ConfigModel.findOneAndUpdate(
    { key: 'agent' },
    { $set: updates },
    { upsert: true }
  )
  return state
}

// Call once after connectDB() — loads persisted config into memory
export async function initConfig(): Promise<void> {
  const saved = await ConfigModel.findOne({ key: 'agent' }).lean()
  if (saved) {
    state.autoApprove      = saved.autoApprove
    state.assets           = saved.assets?.length ? saved.assets : defaultAssets
    if (typeof (saved as any).stopLossPct === 'number')      state.stopLossPct      = (saved as any).stopLossPct
    if (typeof (saved as any).takeProfitPct === 'number')    state.takeProfitPct    = (saved as any).takeProfitPct
    if (typeof (saved as any).maxDrawdownPct === 'number')   state.maxDrawdownPct   = (saved as any).maxDrawdownPct
    if (typeof (saved as any).maxOpenPositions === 'number') state.maxOpenPositions = (saved as any).maxOpenPositions
    if (typeof (saved as any).claudeModel === 'string')      state.claudeModel      = (saved as any).claudeModel
    if (typeof (saved as any).cycleMinutes === 'number')     state.cycleMinutes     = (saved as any).cycleMinutes
    console.log(`[config] Loaded from DB — model: ${state.claudeModel}, cycle: ${state.cycleMinutes}min, autoApprove: ${state.autoApprove}`)
  } else {
    // First run — persist the defaults so they're visible in the DB
    await ConfigModel.create({ key: 'agent', ...state })
    console.log('[config] Initialised defaults in DB')
  }
}
