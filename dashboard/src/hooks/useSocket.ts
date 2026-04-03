import { useEffect, useRef, useCallback } from 'react'
import { WS_URL } from '../api'

export type WsEventType = 'portfolio' | 'trade:new' | 'trade:executed' | 'connected'

export interface WsEvent<T = unknown> {
  type: WsEventType
  data: T
}

type Handler<T = unknown> = (event: WsEvent<T>) => void

const RECONNECT_DELAY_MS = 3_000
const MAX_RECONNECT_DELAY_MS = 30_000

/**
 * Subscribes to the agent WebSocket and calls `onMessage` for each typed event.
 * Reconnects automatically with exponential backoff.
 * Returns a `send` function for two-way communication (future use).
 */
export function useSocket(onMessage: Handler) {
  const wsRef = useRef<WebSocket | null>(null)
  const onMessageRef = useRef(onMessage)
  const reconnectDelay = useRef(RECONNECT_DELAY_MS)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmounted = useRef(false)

  // Always use the latest handler without re-connecting
  useEffect(() => { onMessageRef.current = onMessage }, [onMessage])

  const connect = useCallback(() => {
    if (unmounted.current) return

    const ws = new WebSocket(WS_URL)
    wsRef.current = ws

    ws.onopen = () => {
      reconnectDelay.current = RECONNECT_DELAY_MS
      onMessageRef.current({ type: 'connected', data: null })
    }

    ws.onmessage = (ev) => {
      try {
        const parsed = JSON.parse(ev.data)
        if (parsed && typeof parsed.type === 'string') {
          onMessageRef.current(parsed as WsEvent)
        }
      } catch { /* ignore malformed frames */ }
    }

    ws.onclose = () => {
      if (unmounted.current) return
      reconnectTimer.current = setTimeout(() => {
        reconnectDelay.current = Math.min(reconnectDelay.current * 1.5, MAX_RECONNECT_DELAY_MS)
        connect()
      }, reconnectDelay.current)
    }

    ws.onerror = () => ws.close()
  }, [])

  useEffect(() => {
    unmounted.current = false
    connect()
    return () => {
      unmounted.current = true
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const send = useCallback((payload: unknown) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(payload))
    }
  }, [])

  return { send }
}
