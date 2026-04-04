import { ApiKeyModel } from './schema'

export const KEY_NAMES = [
  'anthropic_api_key',
  'openai_api_key',
  'alpaca_api_key',
  'alpaca_api_secret',
  'alpaca_base_url',
] as const

export type KeyName = typeof KEY_NAMES[number]

const ENV_MAP: Record<KeyName, string> = {
  anthropic_api_key: 'ANTHROPIC_API_KEY',
  openai_api_key:    'OPENAI_API_KEY',
  alpaca_api_key:    'ALPACA_API_KEY',
  alpaca_api_secret: 'ALPACA_API_SECRET',
  alpaca_base_url:   'ALPACA_BASE_URL',
}

// In-memory cache — loaded at startup, updated on write
const cache: Partial<Record<KeyName, string>> = {}

/** Sync getter — env vars take precedence over DB values */
export function getKey(name: KeyName): string | undefined {
  return process.env[ENV_MAP[name]] || cache[name]
}

/** Load all keys from DB into cache. Call once after connectDB(). */
export async function loadKeysFromDB(): Promise<void> {
  const docs = await ApiKeyModel.find().lean()
  for (const doc of docs) {
    if (KEY_NAMES.includes(doc.key as KeyName)) {
      cache[doc.key as KeyName] = doc.value
    }
  }
  console.log(`[keys] Loaded ${docs.length} API key(s) from DB`)
}

/** Persist a key to DB and update cache */
export async function setKey(name: KeyName, value: string): Promise<void> {
  await ApiKeyModel.findOneAndUpdate({ key: name }, { value }, { upsert: true, returnDocument: 'after' })
  cache[name] = value
}

/** Returns all keys with values masked (last 4 chars visible). URLs shown in full. */
export function getMaskedKeys(): Record<KeyName, string> {
  const result = {} as Record<KeyName, string>
  for (const name of KEY_NAMES) {
    const val = getKey(name)
    if (!val) {
      result[name] = ''
    } else if (name === 'alpaca_base_url') {
      result[name] = val
    } else {
      result[name] = `***${val.slice(-4)}`
    }
  }
  return result
}
