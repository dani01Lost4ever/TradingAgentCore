import express from 'express'
import { TradeModel, EquityModel, TokenUsageModel } from './schema'
import { executeOrder } from './executor'
import { markExecuted, exportDataset } from './logger'
import { getLogs } from './logs'
import { getConfig, setConfig } from './config'
import axios from 'axios'
import path from 'path'
import fs from 'fs'

const ALPACA_BASE = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets'
const ALPACA_DATA = 'https://data.alpaca.markets'

const alpacaHeaders = () => ({
  'APCA-API-KEY-ID': process.env.ALPACA_API_KEY!,
  'APCA-API-SECRET-KEY': process.env.ALPACA_API_SECRET!,
})

export function createApiServer(): express.Application {
  const app = express()
  app.use(express.json())

  // CORS for local dashboard dev
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
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
    const record = await TradeModel.findById(req.params.id)
    if (!record) return res.status(404).json({ error: 'Not found' })
    if (record.approved) return res.status(400).json({ error: 'Already approved' })

    try {
      const result = await executeOrder(record.decision)
      await markExecuted(record._id.toString(), result.order_id)
      res.json({ success: true, order: result })
    } catch (err: any) {
      res.status(500).json({ error: err.message })
    }
  })

  // POST /api/trades/:id/reject - dismiss without executing
  app.post('/api/trades/:id/reject', async (req, res) => {
    await TradeModel.findByIdAndUpdate(req.params.id, { approved: true, executed: false })
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
      const response = await axios.get(`${ALPACA_BASE}/v2/assets`, {
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
        axios.get(`${ALPACA_BASE}/v2/account`, { headers: alpacaHeaders() }),
        axios.get(`${ALPACA_BASE}/v2/positions`, { headers: alpacaHeaders() }),
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
        axios.get(`${ALPACA_BASE}/v2/account`, { headers: alpacaHeaders() }),
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
    const { stopLossPct, takeProfitPct, maxDrawdownPct, maxOpenPositions, claudeModel, cycleMinutes } = req.body
    const updates: any = {}
    if (typeof stopLossPct === 'number')      updates.stopLossPct = stopLossPct
    if (typeof takeProfitPct === 'number')    updates.takeProfitPct = takeProfitPct
    if (typeof maxDrawdownPct === 'number')   updates.maxDrawdownPct = maxDrawdownPct
    if (typeof maxOpenPositions === 'number') updates.maxOpenPositions = maxOpenPositions
    if (typeof claudeModel === 'string')      updates.claudeModel = claudeModel
    if (typeof cycleMinutes === 'number')     updates.cycleMinutes = cycleMinutes
    const updated = await setConfig(updates)
    console.log('[api] Config updated:', updates)
    res.json(updated)
  })

  return app
}
