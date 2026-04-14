import { useCallback, useEffect, useState } from 'react'
import { getActiveWalletMode } from '../api'

const ACTIVE_WALLET_EVENT = 'aurora:active-wallet-changed'

export function notifyActiveWalletChange() {
  window.dispatchEvent(new CustomEvent(ACTIVE_WALLET_EVENT))
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

  useEffect(() => {
    refresh()
    const handler = () => refresh()
    window.addEventListener(ACTIVE_WALLET_EVENT, handler)
    return () => window.removeEventListener(ACTIVE_WALLET_EVENT, handler)
  }, [refresh])

  return { wallet, loading, refresh }
}
