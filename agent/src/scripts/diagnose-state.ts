/**
 * Diagnose Atlas state — wallets, API keys, recent trade decisions.
 * Read-only. Masks all secret values.
 *
 * Usage (from agent/):
 *   npx ts-node src/scripts/diagnose-state.ts
 */

import mongoose from 'mongoose'
import { config as loadEnv } from 'dotenv'
import { join } from 'path'

loadEnv({ path: join(__dirname, '../../../.env') })

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/trading-agent'

function maskTail(value: string | undefined, n = 6): string {
  if (!value) return '(empty)'
  if (value.length <= n + 4) return '***'
  return `***${value.slice(-n)}`
}

async function main(): Promise<void> {
  console.log(`Connecting to ${MONGO_URI.replace(/\/\/[^@]+@/, '//***@')}`)
  await mongoose.connect(MONGO_URI)

  const db = mongoose.connection.db!

  // ── Users
  console.log('\n=== USERS ===')
  const users = await db.collection('users').find({}, { projection: { username: 1, role: 1, blocked: 1, twoFactorEnabled: 1 } }).toArray()
  for (const u of users) {
    console.log(`  id=${u._id.toString()}  username=${u.username}  role=${u.role}  blocked=${u.blocked || false}  2fa=${u.twoFactorEnabled || false}`)
  }

  // ── API Keys (masked)
  console.log('\n=== API KEYS (masked) ===')
  const apikeys = await db.collection('apikeys').find({}).toArray()
  for (const k of apikeys) {
    console.log(`  userId=${k.userId}  key=${k.key}  value=${maskTail(k.value)}  length=${(k.value || '').length}`)
  }

  // ── Wallets
  console.log('\n=== WALLETS ===')
  const wallets = await db.collection('wallets').find({}).toArray()
  for (const w of wallets) {
    console.log(`  id=${w._id.toString()}  name=${w.name}  user=${w.userId}  exchange=${w.exchange}  mode=${w.mode}  active=${w.active}  paused=${w.paused || false}  liveTrading=${w.liveTrading || false}`)
    console.log(`    tradingMode=${w.tradingMode || '(unset)'}  cycleMinutes=${w.cycleMinutes ?? '(default)'}  maxTradesPerDay=${w.maxTradesPerDay ?? '(default)'}  minHoldingMinutes=${w.minHoldingMinutes ?? '(default)'}`)
    console.log(`    assets=${JSON.stringify(w.assets || [])}`)
    console.log(`    feeModel=${JSON.stringify(w.feeModel || {})}  taxRatePct=${w.taxRatePct ?? '(default)'}  minNetProfitPct=${w.minNetProfitPct ?? '(default)'}`)
    console.log(`    alpaca_api_key=${maskTail(w.alpaca_api_key)}  alpaca_base=${w.alpaca_base_url || '(none)'}`)
  }

  // ── Global config
  console.log('\n=== CONFIG ===')
  const configs = await db.collection('configs').find({}).toArray()
  for (const c of configs) {
    console.log(`  userId=${c.userId}  assets(global)=${JSON.stringify(c.assets || [])}  cycle=${c.cycleMinutes}min  model=${c.claudeModel}  autoApprove=${c.autoApprove}  activeStrategy=${c.activeStrategy}`)
  }

  // ── Last 10 trades
  console.log('\n=== LAST 10 TRADE DECISIONS ===')
  const trades = await db.collection('trades').find({}).sort({ timestamp: -1 }).limit(10).toArray()
  for (const t of trades) {
    const d = t.decision || {}
    const o = t.outcome || {}
    const reason = (d.reasoning || '').slice(0, 80).replace(/\n/g, ' ')
    console.log(`  ${new Date(t.timestamp).toISOString().slice(0, 19)}  ${d.action.toUpperCase().padEnd(4)}  ${(d.asset || '').padEnd(10)}  $${(d.amount_usd || 0).toString().padStart(7)}  conf=${d.confidence}  exec=${t.executed}  err=${t.execution_error ? '"' + t.execution_error.slice(0, 60) + '"' : '-'}`)
    console.log(`    reasoning="${reason}"`)
  }

  // ── env-loaded anthropic key (so we know what the fallback would be)
  console.log('\n=== ENV FALLBACK ===')
  const envAnthropic = process.env.ANTHROPIC_API_KEY || ''
  console.log(`  ANTHROPIC_API_KEY in env: ${envAnthropic ? maskTail(envAnthropic) : '(not set)'}  length=${envAnthropic.length}`)

  await mongoose.disconnect()
}

main().catch((err) => {
  console.error('Failed:', err.message)
  process.exitCode = 1
}).finally(() => {
  mongoose.disconnect().catch(() => undefined)
})
