export interface LogEntry {
  ts: string
  level: 'info' | 'warn' | 'error'
  msg: string
}

const MAX_ENTRIES = 300
const buffer: LogEntry[] = []

export function pushLog(level: LogEntry['level'], ...args: unknown[]): void {
  const msg = args
    .map(a => (a instanceof Error ? a.message : typeof a === 'string' ? a : JSON.stringify(a)))
    .join(' ')
  buffer.push({ ts: new Date().toISOString(), level, msg })
  if (buffer.length > MAX_ENTRIES) buffer.shift()
}

export function getLogs(limit = 150): LogEntry[] {
  return buffer.slice(-limit)
}

/** Call once at startup to mirror console.* into the ring buffer. */
export function patchConsole(): void {
  const orig = { log: console.log, warn: console.warn, error: console.error }
  console.log = (...a) => { orig.log(...a); pushLog('info', ...a) }
  console.warn = (...a) => { orig.warn(...a); pushLog('warn', ...a) }
  console.error = (...a) => { orig.error(...a); pushLog('error', ...a) }
}
