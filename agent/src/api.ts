import express from 'express'
import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { TradeModel, EquityModel, TokenUsageModel, AuditLogModel, PromptModel, BacktestResultModel, OptimizeResultModel } from './schema'
import { executeOrder } from './executor'
import { markExecuted, exportDataset } from './logger'
import { getLogs } from './logs'
import { getConfig, setConfig } from './config'
import { requireAuth, loginHandler, changePasswordHandler } from './auth'
import { getKey, setKey, getMaskedKeys, KEY_NAMES } from './keys'
import { logAudit } from './audit'
import { isPaused, pauseAgent, resumeAgent } from './agentState'
import type { KeyName } from './keys'
import axios from 'axios'
import path from 'path'
import fs from 'fs'

const ALPACA_DATA = 'https://data.alpaca.markets'

const alpacaBase    = () => getKey('alpaca_base_url') || 'https://paper-api.alpaca.markets'
const alpacaHeaders = () => ({
  'APCA-API-KEY-ID':     getKey('alpaca_api_key')    || '',
  'APCA-API-SECRET-KEY': getKey('alpaca_api_secret') || '',
})

export function createApiServer(): express.Application {
  const app = express()
  app.use(express.json())

  // CORS for local dashboard dev
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  })

  // ── Public routes (no auth needed) ────────────────────────────────────────
  app.post('/api/auth/login', async (req, res) => {
    // Wrap loginHandler to add audit logging on success
    const originalJson = res.json.bind(res)
    res.json = (body: any) => {
      if (body?.token) {
        const username: string = req.body?.username || 'unknown'
        logAudit('login', username + ' logged in', username, req).catch(() => {})
      }
      return originalJson(body)
    }
    return loginHandler(req, res)
  })

  // GET /api/health — public health check
  app.get('/api/health', async (_req, res) => {
    let mongodb = false
    try {
      const { connection } = await import('mongoose')
      mongodb = connection.readyState === 1
    } catch { /* ignore */ }

    const anthropicKeySet = Boolean(getKey('anthropic_api_key'))
    const openaiKeySet    = Boolean(getKey('openai_api_key'))
    const alpacaKeySet    = Boolean(getKey('alpaca_api_key') && getKey('alpaca_api_secret'))

    let lastCycleAt: string | null = null
    try {
      const latest = await TradeModel.findOne().sort({ timestamp: -1 }).lean()
      lastCycleAt = latest?.timestamp?.toISOString() ?? null
    } catch { /* ignore */ }

    const status = mongodb && (anthropicKeySet || openaiKeySet) ? 'ok' : 'degraded'
    res.json({ status, mongodb, anthropicKeySet, openaiKeySet, alpacaKeySet, lastCycleAt, uptime: process.uptime() })
  })

  // GET /api/prices/live — public live price feed
  app.get('/api/prices/live', async (_req, res) => {
    try {
      const assets  = getConfig().assets
      const result: Record<string, { price: number; change24h: number }> = {}

      for (const asset of assets) {
        try {
          const response = await axios.get(`${ALPACA_DATA}/v1beta3/crypto/us/latest/bars`, {
            headers: alpacaHeaders(),
            params: { symbols: asset },
          })
          const bar = response.data.bars?.[asset]
          if (bar) result[asset] = { price: bar.c, change24h: 0 }
        } catch { /* skip asset */ }
      }

      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // ── All routes below require a valid JWT ──────────────────────────────────
  app.use('/api', requireAuth)

  // POST /api/auth/change-password
  app.post('/api/auth/change-password', async (req, res) => {
    const originalJson = res.json.bind(res)
    res.json = (body: any) => {
      if (body?.success) {
        logAudit('password_changed', 'admin password changed', 'admin', req).catch(() => {})
      }
      return originalJson(body)
    }
    return changePasswordHandler(req, res)
  })

  // GET /api/agent/status
  app.get('/api/agent/status', requireAuth, (_req, res) => {
    res.json({ paused: isPaused() })
  })

  // POST /api/agent/pause
  app.post('/api/agent/pause', requireAuth, (req, res) => {
    pauseAgent()
    logAudit('agent.pause', 'Agent paused', (req as any).user, req).catch(() => {})
    res.json({ paused: true })
  })

  // POST /api/agent/resume
  app.post('/api/agent/resume', requireAuth, (req, res) => {
    resumeAgent()
    logAudit('agent.resume', 'Agent resumed', (req as any).user, req).catch(() => {})
    res.json({ paused: false })
  })

  // GET /api/positions — live positions from Alpaca
  app.get('/api/positions', requireAuth, async (_req, res) => {
    try {
      const r = await axios.get(`${alpacaBase()}/v2/positions`, { headers: alpacaHeaders() })
      res.json(r.data)
    } catch {
      res.json([])
    }
  })

  // GET /api/agent/logs?limit=150
  app.get('/api/agent/logs', requireAuth, (req, res) => {
    const limit = Math.min(Number(req.query.limit ?? 150), 500)
    res.json({ logs: getLogs(limit) })
  })

  // GET /api/keys - masked values for all stored keys
  app.get('/api/keys', (_req, res) => {
    res.json(getMaskedKeys())
  })

  // POST /api/keys - set a single key
  app.post('/api/keys', async (req, res) => {
    const { key, value } = req.body
    if (!key || typeof value !== 'string') {
      return res.status(400).json({ error: 'key and value required' })
    }
    if (!KEY_NAMES.includes(key as KeyName)) {
      return res.status(400).json({ error: `Unknown key "${key}"` })
    }
    await setKey(key as KeyName, value.trim())
    await logAudit('key_set', key + ' updated', 'admin', req)
    console.log(`[api] Key "${key}" updated`)
    res.json({ success: true })
  })

  // GET /api/models?provider=claude|openai - fetch available models from the provider API
  app.get('/api/models', async (req, res) => {
    const provider = (req.query.provider as string) || 'claude'

    try {
      if (provider === 'claude') {
        const apiKey = getKey('anthropic_api_key')
        if (!apiKey) return res.status(400).json({ error: 'Anthropic API key not set' })
        const client = new Anthropic({ apiKey })
        const page = await client.models.list({ limit: 100 })
        const models = page.data.map((m: { id: string; display_name?: string }) => ({
          id: m.id,
          name: m.display_name || m.id,
        }))
        return res.json({ models })
      }

      if (provider === 'openai') {
        const apiKey = getKey('openai_api_key')
        if (!apiKey) return res.status(400).json({ error: 'OpenAI API key not set' })
        const client = new OpenAI({ apiKey })
        const page = await client.models.list()
        // Filter to chat-capable models only (exclude embeddings, audio, image, tts, etc.)
        const chatPrefixes = ['gpt-', 'o1', 'o3', 'o4']
        const models = page.data
          .filter(m => chatPrefixes.some(p => m.id.startsWith(p)))
          .sort((a, b) => b.created - a.created)
          .map(m => ({ id: m.id, name: m.id }))
        return res.json({ models })
      }

      res.status(400).json({ error: `Unknown provider "${provider}"` })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/trades?limit=50&page=1
  app.get('/api/trades', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 50
    const page = parseInt(req.query.page as string) || 1
    const trades = await TradeModel.find()
      .sort({ timestamp: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()
    const total = await TradeModel.countDocuments()
    res.json({ trades, total, page, limit })
  })

  // GET /api/trades/pending - unapproved non-hold decisions
  app.get('/api/trades/pending', async (req, res) => {
    const pending = await TradeModel.find({
      approved: false,
      'decision.action': { $ne: 'hold' },
    })
      .sort({ timestamp: -1 })
      .lean()
    res.json(pending)
  })

  // GET /api/stats - summary for dashboard
  app.get('/api/stats', async (req, res) => {
    const [total, executed, profitable, datasetSize] = await Promise.all([
      TradeModel.countDocuments(),
      TradeModel.countDocuments({ executed: true }),
      TradeModel.countDocuments({ 'outcome.correct': true }),
      TradeModel.countDocuments({ 'outcome.correct': true, executed: true }),
    ])

    const pnlAgg = await TradeModel.aggregate([
      { $match: { 'outcome.pnl_usd': { $exists: true } } },
      { $group: { _id: null, total_pnl: { $sum: '$outcome.pnl_usd' } } },
    ])

    res.json({
      total_decisions: total,
      executed_trades: executed,
      profitable_trades: profitable,
      win_rate: executed > 0 ? ((profitable / executed) * 100).toFixed(1) : '0',
      total_pnl_usd: pnlAgg[0]?.total_pnl?.toFixed(2) ?? '0.00',
      dataset_size: datasetSize,
    })
  })

  // POST /api/trades/:id/approve - human gate
  app.post('/api/trades/:id/approve', async (req, res) => {
    const id = req.params.id
    const record = await TradeModel.findById(id)
    if (!record) return res.status(404).json({ error: 'Not found' })
    if (record.approved) return res.status(400).json({ error: 'Already approved' })

    try {
      const result = await executeOrder(record.decision)
      await markExecuted(record._id.toString(), result.order_id)
      await logAudit('trade_approved', id, 'admin', req)
      res.json({ success: true, order: result })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // POST /api/trades/:id/reject - dismiss without executing
  app.post('/api/trades/:id/reject', async (req, res) => {
    const id = req.params.id
    await TradeModel.findByIdAndUpdate(id, { approved: true, executed: false })
    await logAudit('trade_rejected', id, 'admin', req)
    res.json({ success: true })
  })

  // GET /api/config - current runtime config
  app.get('/api/config', (req, res) => {
    res.json(getConfig())
  })

  // POST /api/config - update runtime config
  app.post('/api/config', async (req, res) => {
    const { autoApprove } = req.body
    if (typeof autoApprove !== 'boolean') {
      return res.status(400).json({ error: 'autoApprove must be a boolean' })
    }
    await logAudit('config_change', JSON.stringify(req.body), 'admin', req)
    const updated = await setConfig({ autoApprove })
    console.log(`[api] autoApprove set to ${autoApprove}`)

    // When switching TO auto-approve, drain any pending trades immediately
    if (autoApprove) {
      const pending = await TradeModel.find({
        approved: false,
        'decision.action': { $ne: 'hold' },
      }).lean()

      if (pending.length) {
        console.log(`[api] Auto-trade enabled — executing ${pending.length} pending trade(s)...`)
        for (const trade of pending) {
          try {
            const result = await executeOrder(trade.decision)
            await markExecuted(trade._id.toString(), result.order_id)
            console.log(`[api] Auto-executed pending ${trade.decision.action.toUpperCase()} ${trade.decision.asset}`)
          } catch (err: any) {
            console.error(`[api] Failed to execute pending ${trade.decision.asset}: ${err.message}`)
          }
        }
      }
    }

    res.json(updated)
  })

  // GET /api/training/status - LLM provider, dataset size, Ollama reachability
  app.get('/api/training/status', async (req, res) => {
    const provider = process.env.LLM_PROVIDER || 'claude'
    const ollamaBase = process.env.OLLAMA_BASE_URL || 'http://localhost:11434'
    const ollamaModel = process.env.OLLAMA_MODEL || 'trading-llm'

    const datasetSize = await TradeModel.countDocuments({ 'outcome.correct': true, executed: true })

    // Find latest export file
    const exportsDir = path.join(process.cwd(), 'exports')
    let lastExport: string | null = null
    let lastExportFile: string | null = null
    if (fs.existsSync(exportsDir)) {
      const files = fs.readdirSync(exportsDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(exportsDir, f)).mtime }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())
      if (files.length) {
        lastExport = files[0].mtime.toISOString()
        lastExportFile = files[0].name
      }
    }

    // Ping Ollama
    let ollamaReachable = false
    try {
      await axios.get(`${ollamaBase}/api/tags`, { timeout: 3000 })
      ollamaReachable = true
    } catch { /* not running */ }

    res.json({ provider, ollamaModel, ollamaBase, ollamaReachable, datasetSize, lastExport, lastExportFile })
  })

  // GET /api/dataset/download - download the latest exported JSONL
  app.get('/api/dataset/download', (req, res) => {
    const exportsDir = path.join(process.cwd(), 'exports')
    if (!fs.existsSync(exportsDir)) return res.status(404).json({ error: 'No exports yet' })

    const files = fs.readdirSync(exportsDir)
      .filter(f => f.endsWith('.jsonl'))
      .map(f => ({ name: f, mtime: fs.statSync(path.join(exportsDir, f)).mtime }))
      .sort((a, b) => b.mtime.getTime() - a.mtime.getTime())

    if (!files.length) return res.status(404).json({ error: 'No exports yet — click Export first' })

    const latest = path.join(exportsDir, files[0].name)
    res.download(latest, files[0].name)
  })

  // GET /api/logs - recent agent log entries from ring buffer
  app.get('/api/logs', (req, res) => {
    const limit = parseInt(req.query.limit as string) || 150
    res.json(getLogs(limit))
  })

  // GET /api/assets/available - all tradeable crypto assets from Alpaca
  app.get('/api/assets/available', async (req, res) => {
    try {
      const response = await axios.get(`${alpacaBase()}/v2/assets`, {
        headers: alpacaHeaders(),
        params: { asset_class: 'crypto', status: 'active' },
      })
      const assets = (response.data as any[])
        .filter(a => a.tradable && a.status === 'active')
        .map(a => ({ symbol: a.symbol, name: a.name || a.symbol }))
        .sort((a, b) => a.symbol.localeCompare(b.symbol))
      res.json(assets)
    } catch (err: any) {
      if (err.response) {
        res.status(err.response.status).json({ error: err.response.data })
      } else {
        res.status(500).json({ error: err.message })
      }
    }
  })

  // GET /api/assets/active - currently active trading assets
  app.get('/api/assets/active', (req, res) => {
    res.json(getConfig().assets)
  })

  // POST /api/assets/active - update active trading assets
  app.post('/api/assets/active', async (req, res) => {
    const { assets } = req.body
    if (!Array.isArray(assets) || assets.some(a => typeof a !== 'string')) {
      return res.status(400).json({ error: 'assets must be a string array' })
    }
    const updated = await setConfig({ assets })
    console.log(`[api] Active assets updated: ${assets.join(', ')}`)
    res.json(updated.assets)
  })

  // GET /api/charts/:asset?timeframe=1H&limit=100 - OHLCV bars for charting
  app.get('/api/charts/:asset', async (req, res) => {
    const asset = decodeURIComponent(req.params.asset)
    const timeframe = (req.query.timeframe as string) || '1H'
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    try {
      const response = await axios.get(`${ALPACA_DATA}/v1beta3/crypto/us/bars`, {
        headers: alpacaHeaders(),
        params: { symbols: asset, timeframe, limit },
      })
      res.json(response.data.bars[asset] || [])
    } catch (err: any) {
      if (err.response) {
        res.status(err.response.status).json({ error: err.response.data })
      } else {
        res.status(500).json({ error: err.message })
      }
    }
  })

  // POST /api/dataset/export - trigger JSONL export
  app.post('/api/dataset/export', async (req, res) => {
    const outPath = path.join(process.cwd(), 'exports', `dataset_${Date.now()}.jsonl`)
    const { mkdirSync } = await import('fs')
    mkdirSync(path.join(process.cwd(), 'exports'), { recursive: true })
    const count = await exportDataset(outPath)
    res.json({ success: true, count, path: outPath })
  })

  // GET /api/equity/history - for drawdown chart
  app.get('/api/equity/history', async (req, res) => {
    const limit = parseInt(req.query.limit as string) || 200
    const history = await EquityModel.find().sort({ ts: -1 }).limit(limit).lean()
    res.json(history.reverse())
  })

  // GET /api/portfolio/detail - positions with market values
  app.get('/api/portfolio/detail', async (req, res) => {
    try {
      const [accountRes, positionsRes] = await Promise.all([
        axios.get(`${alpacaBase()}/v2/account`, { headers: alpacaHeaders() }),
        axios.get(`${alpacaBase()}/v2/positions`, { headers: alpacaHeaders() }),
      ])
      const cash = parseFloat(accountRes.data.cash)
      const equity = parseFloat(accountRes.data.equity)
      const positions = positionsRes.data.map((p: any) => ({
        asset: p.symbol.replace(/([A-Z]+)(USD)$/, '$1/USD'),
        qty: parseFloat(p.qty),
        entry_price: parseFloat(p.avg_entry_price),
        current_price: parseFloat(p.current_price),
        market_value: parseFloat(p.market_value),
        unrealized_pl: parseFloat(p.unrealized_pl),
        unrealized_plpc: parseFloat(p.unrealized_plpc) * 100,
      }))
      res.json({ cash, equity, positions })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/stats/per-asset - P&L breakdown by asset
  app.get('/api/stats/per-asset', async (req, res) => {
    const perAsset = await TradeModel.aggregate([
      { $match: { 'outcome.pnl_usd': { $exists: true } } },
      { $group: {
        _id: '$decision.asset',
        total_pnl: { $sum: '$outcome.pnl_usd' },
        trade_count: { $sum: 1 },
        wins: { $sum: { $cond: ['$outcome.correct', 1, 0] } },
      }},
      { $sort: { total_pnl: -1 } },
    ])
    res.json(perAsset.map(a => ({
      asset: a._id,
      total_pnl: parseFloat(a.total_pnl.toFixed(2)),
      trade_count: a.trade_count,
      win_rate: a.trade_count > 0 ? parseFloat(((a.wins / a.trade_count) * 100).toFixed(1)) : 0,
    })))
  })

  // GET /api/risk/status
  app.get('/api/risk/status', async (req, res) => {
    try {
      const [accountRes] = await Promise.all([
        axios.get(`${alpacaBase()}/v2/account`, { headers: alpacaHeaders() }),
      ])
      const equity = parseFloat(accountRes.data.equity)
      const { getRiskStatus } = await import('./risk')
      const status = await getRiskStatus(getConfig() as any, equity)
      res.json(status)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/tokens/stats - aggregate token usage and cost
  app.get('/api/tokens/stats', async (req, res) => {
    const [totals, byModel, daily] = await Promise.all([
      // Overall totals
      TokenUsageModel.aggregate([
        { $group: {
          _id: null,
          total_input:  { $sum: '$input_tokens' },
          total_output: { $sum: '$output_tokens' },
          total_cost:   { $sum: '$cost_usd' },
          total_calls:  { $sum: 1 },
        }},
      ]),
      // Breakdown per model
      TokenUsageModel.aggregate([
        { $group: {
          _id:          '$llm_model',
          input_tokens: { $sum: '$input_tokens' },
          output_tokens:{ $sum: '$output_tokens' },
          cost_usd:     { $sum: '$cost_usd' },
          calls:        { $sum: 1 },
        }},
        { $sort: { cost_usd: -1 } },
      ]),
      // Daily cost for the last 30 days
      TokenUsageModel.aggregate([
        { $match: { ts: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
        { $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } },
          cost_usd:     { $sum: '$cost_usd' },
          input_tokens: { $sum: '$input_tokens' },
          output_tokens:{ $sum: '$output_tokens' },
          calls:        { $sum: 1 },
        }},
        { $sort: { _id: 1 } },
      ]),
    ])

    res.json({
      total_calls:   totals[0]?.total_calls   ?? 0,
      total_input:   totals[0]?.total_input   ?? 0,
      total_output:  totals[0]?.total_output  ?? 0,
      total_cost:    parseFloat((totals[0]?.total_cost ?? 0).toFixed(4)),
      by_model: byModel.map(m => ({
        model:         m._id,
        input_tokens:  m.input_tokens,
        output_tokens: m.output_tokens,
        cost_usd:      parseFloat(m.cost_usd.toFixed(4)),
        calls:         m.calls,
      })),
      daily: daily.map(d => ({
        date:          d._id,
        cost_usd:      parseFloat(d.cost_usd.toFixed(4)),
        input_tokens:  d.input_tokens,
        output_tokens: d.output_tokens,
        calls:         d.calls,
      })),
    })
  })

  // GET /api/tokens/history?limit=200 - raw call log
  app.get('/api/tokens/history', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 200, 1000)
    const rows = await TokenUsageModel.find()
      .sort({ ts: -1 })
      .limit(limit)
      .lean()
    res.json(rows.reverse())
  })

  // POST /api/config/risk - update risk + LLM settings
  app.post('/api/config/risk', async (req, res) => {
    const { stopLossPct, takeProfitPct, maxDrawdownPct, maxOpenPositions, claudeModel, cycleMinutes,
            confidenceThreshold, kellyEnabled, consensusMode, consensusModel,
            trailingStopEnabled, trailingStopPct,
            activeStrategy, strategyParams, autoFallbackToLlm } = req.body
    const updates: any = {}
    if (typeof stopLossPct === 'number')           updates.stopLossPct           = stopLossPct
    if (typeof takeProfitPct === 'number')         updates.takeProfitPct         = takeProfitPct
    if (typeof maxDrawdownPct === 'number')        updates.maxDrawdownPct        = maxDrawdownPct
    if (typeof maxOpenPositions === 'number')      updates.maxOpenPositions      = maxOpenPositions
    if (typeof claudeModel === 'string')           updates.claudeModel           = claudeModel
    if (typeof cycleMinutes === 'number')          updates.cycleMinutes          = cycleMinutes
    if (typeof confidenceThreshold === 'number')   updates.confidenceThreshold   = confidenceThreshold
    if (typeof kellyEnabled === 'boolean')         updates.kellyEnabled          = kellyEnabled
    if (typeof consensusMode === 'boolean')        updates.consensusMode         = consensusMode
    if (typeof consensusModel === 'string')        updates.consensusModel        = consensusModel
    if (typeof trailingStopEnabled === 'boolean')  updates.trailingStopEnabled   = trailingStopEnabled
    if (typeof trailingStopPct === 'number')       updates.trailingStopPct       = trailingStopPct
    if (typeof activeStrategy === 'string')        updates.activeStrategy        = activeStrategy
    if (strategyParams !== undefined)              updates.strategyParams        = strategyParams
    if (typeof autoFallbackToLlm === 'boolean')    updates.autoFallbackToLlm     = autoFallbackToLlm
    await logAudit('config_change', JSON.stringify(req.body), 'admin', req)
    const updated = await setConfig(updates)
    console.log('[api] Config updated:', updates)
    res.json(updated)
  })

  // GET /api/audit?limit=100
  app.get('/api/audit', async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit as string) || 100, 500)
    const events = await AuditLogModel.find().sort({ ts: -1 }).limit(limit).lean()
    res.json({ events })
  })

  // GET /api/prompt
  app.get('/api/prompt', async (_req, res) => {
    const doc = await PromptModel.findOne({ key: 'system_prompt' }).lean()
    res.json({ systemPrompt: doc?.value ?? null })
  })

  // POST /api/prompt
  app.post('/api/prompt', async (req, res) => {
    const { systemPrompt } = req.body
    if (typeof systemPrompt !== 'string') {
      return res.status(400).json({ error: 'systemPrompt must be a string' })
    }
    await PromptModel.findOneAndUpdate(
      { key: 'system_prompt' },
      { value: systemPrompt, updatedAt: new Date() },
      { upsert: true, returnDocument: 'after' }
    )
    res.json({ success: true })
  })

  // DELETE /api/prompt
  app.delete('/api/prompt', async (_req, res) => {
    await PromptModel.deleteOne({ key: 'system_prompt' })
    res.json({ success: true })
  })

  // POST /api/backtest
  app.post('/api/backtest', async (req, res) => {
    const { assets, startDate, endDate, cycleHours, mode, model } = req.body
    if (!Array.isArray(assets) || !startDate || !endDate) {
      return res.status(400).json({ error: 'assets, startDate, endDate are required' })
    }
    try {
      const { runBacktest } = await import('./backtest')
      const result = await runBacktest({
        assets,
        startDate,
        endDate,
        cycleHours: typeof cycleHours === 'number' ? cycleHours : 24,
        model:      typeof model === 'string' ? model : getConfig().claudeModel,
        mode:       mode === 'llm' ? 'llm' : 'rules',
        startEquity:    10000,
        maxPositionUsd: 500,
      })
      res.json(result)
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/backtest/results
  app.get('/api/backtest/results', async (_req, res) => {
    const results = await BacktestResultModel.find()
      .sort({ runAt: -1 })
      .select('-trades')
      .lean()
    res.json(results)
  })

  // GET /api/equity/benchmark
  app.get('/api/equity/benchmark', async (_req, res) => {
    try {
      const history = await EquityModel.find().sort({ ts: 1 }).lean()
      if (!history.length) return res.json({ points: [], benchmarkAsset: 'BTC/USD' })

      const firstSnap = history[0]
      const firstTs   = new Date(firstSnap.ts).toISOString()

      // Fetch BTC/USD hourly bars from the start date to now
      const btcResponse = await axios.get(`${ALPACA_DATA}/v1beta3/crypto/us/bars`, {
        headers: alpacaHeaders(),
        params: { symbols: 'BTC/USD', timeframe: '1H', start: firstTs, limit: 1000 },
      })
      const btcBars: any[] = btcResponse.data.bars?.['BTC/USD'] || []
      if (!btcBars.length) return res.json({ points: [], benchmarkAsset: 'BTC/USD' })

      const btcStartPrice = btcBars[0].c
      const startEquity   = firstSnap.equity

      // Build a map: timestamp (hour) → btc price
      const btcPriceMap = new Map<number, number>()
      for (const bar of btcBars) {
        const hour = Math.floor(new Date(bar.t).getTime() / 3_600_000) * 3_600_000
        btcPriceMap.set(hour, bar.c)
      }

      // Align equity history with BTC benchmark
      const points = history.map(snap => {
        const hour     = Math.floor(new Date(snap.ts).getTime() / 3_600_000) * 3_600_000
        const btcPrice = btcPriceMap.get(hour) ?? btcBars[btcBars.length - 1].c
        const benchmark = startEquity * (btcPrice / btcStartPrice)
        return { ts: snap.ts, equity: snap.equity, benchmark: parseFloat(benchmark.toFixed(2)) }
      })

      res.json({ points, benchmarkAsset: 'BTC/USD' })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // GET /api/trades/reasoning?asset=&action=&outcome=correct|incorrect&limit=50&page=1
  app.get('/api/trades/reasoning', async (req, res) => {
    const limit  = Math.min(parseInt(req.query.limit as string) || 50, 200)
    const page   = parseInt(req.query.page as string) || 1
    const filter: Record<string, any> = {}

    if (req.query.asset)  filter['decision.asset']  = req.query.asset
    if (req.query.action) filter['decision.action'] = req.query.action
    if (req.query.outcome === 'correct')   filter['outcome.correct'] = true
    if (req.query.outcome === 'incorrect') filter['outcome.correct'] = false

    const [trades, total] = await Promise.all([
      TradeModel.find(filter)
        .sort({ timestamp: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select('timestamp decision outcome executed approved')
        .lean(),
      TradeModel.countDocuments(filter),
    ])

    res.json({ trades, total, page, limit })
  })

  // GET /api/strategies
  app.get('/api/strategies', requireAuth, (_req, res) => {
    const { listStrategies } = require('./strategies/registry')
    res.json({ strategies: listStrategies() })
  })

  // GET /api/strategy/params?strategyId=momentum
  app.get('/api/strategy/params', requireAuth, (req, res) => {
    const { getStrategy: gs, mergeWithDefaults: mwd } = require('./strategies/registry')
    const strategyId = String(req.query.strategyId || 'momentum')
    const saved = getConfig().strategyParams?.[strategyId] ?? {}
    try {
      const strategy = gs(strategyId)
      const merged = mwd(strategy.params, saved as any)
      res.json(merged)
    } catch {
      res.status(404).json({ error: 'Unknown strategy' })
    }
  })

  // POST /api/strategy/params
  app.post('/api/strategy/params', requireAuth, async (req, res) => {
    const { strategyId, params } = req.body
    if (!strategyId || !params) return res.status(400).json({ error: 'strategyId and params required' })
    const current = getConfig().strategyParams ?? {}
    await setConfig({ strategyParams: { ...current, [strategyId]: params } })
    logAudit('strategy.params', `Updated params for ${strategyId}`, (req as any).user, req).catch(() => {})
    res.json({ success: true })
  })

  // POST /api/config/strategy
  app.post('/api/config/strategy', requireAuth, async (req, res) => {
    const { activeStrategy, autoFallbackToLlm } = req.body
    const updates: any = {}
    if (activeStrategy !== undefined) updates.activeStrategy = activeStrategy
    if (autoFallbackToLlm !== undefined) updates.autoFallbackToLlm = autoFallbackToLlm
    const cfg = await setConfig(updates)
    logAudit('strategy.select', `Active strategy set to ${activeStrategy}`, (req as any).user, req).catch(() => {})
    res.json(cfg)
  })

  // POST /api/backtest/compare
  app.post('/api/backtest/compare', requireAuth, async (req, res) => {
    try {
      const { strategyIds, assets, startDate, endDate, cycleHours, startEquity, maxPositionUsd = 500, strategyParams = {} } = req.body
      if (!strategyIds?.length) return res.status(400).json({ error: 'strategyIds required' })

      const { runBacktest: rb } = await import('./backtest')
      const { getStrategy: gs } = await import('./strategies/registry')

      const results = await Promise.all(
        (strategyIds as string[]).map(async (sid: string) => {
          const bt = await rb({
            assets, startDate, endDate, cycleHours,
            strategyId: sid,
            strategyParams: strategyParams[sid] ?? {},
            startEquity, maxPositionUsd, model: '', mode: 'rules',
            saveToDb: false,
          })
          // Build equity curve from trades
          let eq = startEquity
          const equityCurve = (bt.trades || []).map((t: any) => {
            eq += t.pnl_usd
            return { ts: t.ts, equity: Math.round(eq) }
          })
          return { strategyId: sid, label: (() => { try { return gs(sid).label } catch { return sid } })(), result: bt, equityCurve }
        })
      )
      res.json({ strategies: results })
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  // POST /api/optimize
  app.post('/api/optimize', requireAuth, async (req, res) => {
    try {
      const { strategyId, assets, startDate, endDate, cycleHours, startEquity, maxPositionUsd = 500, paramGrid } = req.body
      if (!strategyId || !paramGrid) return res.status(400).json({ error: 'strategyId and paramGrid required' })

      // Guard against combinatorial explosion
      const combos = Object.values(paramGrid as Record<string, any[]>).reduce((a, b) => a * b.length, 1)
      if (combos > 500) return res.status(400).json({ error: `Too many combinations (${combos}), max 500` })

      const { runOptimization } = await import('./optimizer')
      const result = await runOptimization({ strategyId, assets, startDate, endDate, cycleHours, startEquity, maxPositionUsd, paramGrid })
      res.json(result)
    } catch (e: any) {
      res.status(500).json({ error: e.message })
    }
  })

  // GET /api/optimize/results?strategyId=momentum
  app.get('/api/optimize/results', requireAuth, async (req, res) => {
    const filter: any = {}
    if (req.query.strategyId) filter.strategyId = req.query.strategyId
    const results = await OptimizeResultModel.find(filter).sort({ runAt: -1 }).limit(20).lean()
    res.json(results)
  })

  return app
}
