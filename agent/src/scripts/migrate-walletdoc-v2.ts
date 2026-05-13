/**
 * Migration: WalletDoc v2
 *
 * Adds all new fields introduced in schema v2 to existing Wallet documents.
 * Idempotent — fields already present are left unchanged.
 *
 * Usage:
 *   npx ts-node src/scripts/migrate-walletdoc-v2.ts
 */

import mongoose from 'mongoose'

const uri = process.env.MONGO_URI ?? 'mongodb://localhost:27017/trading-agent'

// Minimal schema — only what we need for the migration bulk-write.
// We do NOT import WalletModel from schema.ts to avoid pulling in all models.
const RawWalletSchema = new mongoose.Schema({}, { strict: false, timestamps: true })
const Wallet = mongoose.model('Wallet', RawWalletSchema)

async function main(): Promise<void> {
  await mongoose.connect(uri)
  console.log('[migrate] Connected to MongoDB')

  const total = await Wallet.countDocuments()
  console.log(`Wallets found: ${total}`)

  if (total === 0) {
    console.log('[migrate] Nothing to migrate.')
    return
  }

  // Build a single $set that only fires when the field does not yet exist.
  // We use a conditional update per document so that already-migrated docs
  // are not counted as "updated" by the driver.
  const defaultFeeModel = { kind: 'percent', value: 0, minFee: 0 }

  const fieldDefaults: Record<string, unknown> = {
    tradingMode:      'swing',
    cycleMinutes:     0,
    assets:           [],
    maxTradesPerDay:  0,
    minHoldingMinutes: 0,
    paused:           false,
    pausedAt:         null,
    pausedReason:     null,
    feeModel:         defaultFeeModel,
    taxRatePct:       26,
    minNetProfitPct:  0.5,
    liveTrading:      false,
    ibkr_gateway_url:   'http://localhost:5000',
    ibkr_session_token: '',
    bitpanda_api_key:   '',
    bitpanda_api_secret: '',
  }

  // Build a query that matches docs missing ANY of the new fields, so the
  // second run sees 0 candidates immediately and we skip the cursor entirely.
  const missingAny: Record<string, unknown>[] = Object.keys(fieldDefaults).map(
    (k) => ({ [k]: { $exists: false } }),
  )

  const cursor = Wallet.find({ $or: missingAny }).cursor()

  let inspected = 0
  let updated = 0

  for await (const doc of cursor) {
    inspected++

    const patch: Record<string, unknown> = {}
    for (const [field, defaultValue] of Object.entries(fieldDefaults)) {
      if ((doc as unknown as Record<string, unknown>)[field] === undefined) {
        patch[field] = defaultValue
      }
    }

    if (Object.keys(patch).length > 0) {
      await Wallet.updateOne({ _id: doc._id }, { $set: patch })
      updated++
      console.log(`  Updated wallet ${doc._id} — set ${Object.keys(patch).join(', ')}`)
    }
  }

  console.log(`\nMigration complete. Inspected: ${inspected} | Updated: ${updated}`)
}

main()
  .catch((err) => {
    console.error('[migrate] Migration failed:', err)
    process.exitCode = 1
  })
  .finally(() => {
    mongoose.disconnect().catch(() => undefined)
  })
