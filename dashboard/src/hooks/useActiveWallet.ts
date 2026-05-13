import { useCallback, useEffect, useState } from 'react'
import { getActiveWalletMode, getWsUrl } from '../api'

const ACTIVE_WALLET_EVENT = 'aurora:active-wallet-changed'

export function notifyActiveWalletChange(walletId: string) {
  window.dispatchEvent(new CustomEvent(ACTIVE_WALLET_EVENT, { detail: { walletId } }))
}

export function useActiveWallet() {
  const [wallet, setWallet] = useState<Awaited<ReturnType<typeof getActiveWalletMode>> | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getActiveWalletMode()
      setWallet(data)
    } catch (err) {
      console.error('[useActiveWallet] failed to load wallet', err)
      setWallet(null)
    } finally {
      setLoading(false)
    }
  }, [])

  // Listen for local tab dispatches
  useEffect(() => {
    refresh()
    const handler = () => refresh()
    window.addEventListener(ACTIVE_WALLET_EVENT, handler)
    return () => window.removeEventListener(ACTIVE_WALLET_EVENT, handler)
  }, [refresh])

  // Listen for server-push wallet:switched events so other tabs / the backend also trigger a refresh
  useEffect(() => {
    const wsUrl = getWsUrl()
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let unmounted = false

    const connect = () => {
      if (unmounted) return
      ws = new WebSocket(wsUrl)
      ws.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data)
          if (parsed?.type === 'wallet:switched') {
            refresh()
          }
        } catch { /* ignore */ }
      }
      ws.onclose = () => {
        if (unmounted) return
        reconnectTimer = setTimeout(connect, 3_000)
      }
      ws.onerror = () => ws?.close()
    }

    connect()

    return () => {
      unmounted = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      ws?.close()
    }
  }, [refresh])

  return { wallet, loading, refresh }
}
