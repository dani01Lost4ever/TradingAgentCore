import { useState } from 'react'
import { Nav } from './components/Nav'
import { Overview } from './pages/Overview'
import { Assets } from './pages/Assets'
import { Charts } from './pages/Charts'
import { Settings } from './pages/Settings'
import { Tokens } from './pages/Tokens'
import { Backtest } from './pages/Backtest'
import { ReasoningHistory } from './pages/ReasoningHistory'
import { AuditLog } from './pages/AuditLog'
import { Login } from './pages/Login'
import { Wiki } from './pages/Wiki'
import { auth } from './api'

export type Page = 'overview' | 'charts' | 'assets' | 'tokens' | 'settings' | 'backtest' | 'reasoning' | 'auditlog' | 'wiki'

export function App() {
  const [loggedIn, setLoggedIn] = useState(auth.isLoggedIn)
  const [page, setPage]         = useState<Page>('overview')

  if (!loggedIn) {
    return <Login onLogin={() => setLoggedIn(true)} />
  }

  const handleLogout = () => {
    auth.clearToken()
    setLoggedIn(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Nav current={page} onNavigate={setPage} onLogout={handleLogout} />
      <main style={{ flex: 1 }}>
        {page === 'overview'  && <Overview />}
        {page === 'charts'    && <Charts />}
        {page === 'assets'    && <Assets />}
        {page === 'tokens'    && <Tokens />}
        {page === 'settings'  && <Settings />}
        {page === 'backtest'  && <Backtest />}
        {page === 'reasoning' && <ReasoningHistory />}
        {page === 'auditlog'  && <AuditLog />}
        {page === 'wiki'      && <Wiki />}
      </main>
    </div>
  )
}
