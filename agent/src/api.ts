import express from 'express'
import { TradeModel } from './schema'
import { executeOrder } from './executor'
import { markExecuted, exportDataset } from './logger'
import { getLogs } from './logs'
import { getConfig, setConfig } from './config'
import axios from 'axios'
import path from 'path'
import fs from 'fs'

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
  app.post('/api/config', (req, res) => {
    const { autoApprove } = req.body
    if (typeof autoApprove !== 'boolean') {
      return res.status(400).json({ error: 'autoApprove must be a boolean' })
    }
    const updated = setConfig({ autoApprove })
    console.log(`[api] autoApprove set to ${autoApprove}`)
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

  // POST /api/dataset/export - trigger JSONL export
  app.post('/api/dataset/export', async (req, res) => {
    const outPath = path.join(process.cwd(), 'exports', `dataset_${Date.now()}.jsonl`)
    const { mkdirSync } = await import('fs')
    mkdirSync(path.join(process.cwd(), 'exports'), { recursive: true })
    const count = await exportDataset(outPath)
    res.json({ success: true, count, path: outPath })
  })

  return app
}
