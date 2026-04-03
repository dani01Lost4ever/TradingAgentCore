import { useState } from 'react'
import { Nav } from './components/Nav'
import { Overview } from './pages/Overview'
import { Assets } from './pages/Assets'
import { Charts } from './pages/Charts'
import { Settings } from './pages/Settings'
import { Tokens } from './pages/Tokens'

export type Page = 'overview' | 'charts' | 'assets' | 'tokens' | 'settings'

export function App() {
  const [page, setPage] = useState<Page>('overview')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <Nav current={page} onNavigate={setPage} />
      <main style={{ flex: 1 }}>
        {page === 'overview' && <Overview />}
        {page === 'charts'   && <Charts />}
        {page === 'assets'   && <Assets />}
        {page === 'tokens'   && <Tokens />}
        {page === 'settings' && <Settings />}
      </main>
    </div>
  )
}
