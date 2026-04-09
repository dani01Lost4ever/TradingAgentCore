// One-time migration: stamp walletId on all existing Trade and EquitySnapshot records.
// Run with: npm run backfill:wallet-ids
import mongoose from 'mongoose'
import { TradeModel, EquityModel, WalletModel } from '../schema'

async function main() {
  const uri = process.env.MONGO_URI || 'mongodb://localhost:27017/trading-agent'
  await mongoose.connect(uri)
  console.log('[backfill] Connected to MongoDB')

  const userIds: string[] = await TradeModel.distinct('userId')
  console.log(`[backfill] Processing ${userIds.length} users`)

  for (const userId of userIds) {
    const wallets = await WalletModel.find({ userId }).sort({ createdAt: 1 }).lean()
    if (!wallets.length) {
      console.log(`[backfill] No wallets for user ${userId}, skipping`)
      continue
    }

    // Find the wallet whose createdAt is <= recordDate (latest such wallet)
    function walletAtTime(date: Date): string | undefined {
      let best: (typeof wallets)[number] | undefined
      for (const w of wallets) {
        if ((w as any).createdAt <= date) best = w
      }
      return best?._id?.toString()
    }

    const trades = await TradeModel.find({ userId, walletId: { $exists: false } }).lean()
    console.log(`[backfill] User ${userId}: ${trades.length} trades to backfill`)
    for (const t of trades) {
      const wid = walletAtTime(t.timestamp)
      if (wid) await TradeModel.updateOne({ _id: t._id }, { walletId: wid })
    }

    const snaps = await EquityModel.find({ userId, walletId: { $exists: false } }).lean()
    console.log(`[backfill] User ${userId}: ${snaps.length} equity snapshots to backfill`)
    for (const s of snaps) {
      const wid = walletAtTime(s.ts)
      if (wid) await EquityModel.updateOne({ _id: s._id }, { walletId: wid })
    }
  }

  console.log('[backfill] Done')
  await mongoose.disconnect()
}

main().catch(err => {
  console.error('[backfill] Error:', err)
  process.exit(1)
})
