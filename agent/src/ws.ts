import { WebSocketServer, WebSocket } from 'ws'
import { Server } from 'http'

let wss: WebSocketServer | null = null
const clients = new Set<WebSocket>()

export function initWebSocket(server: Server): void {
  wss = new WebSocketServer({ server, path: '/ws' })
  wss.on('connection', (ws) => {
    clients.add(ws)
    ws.on('close', () => clients.delete(ws))
    ws.on('error', () => clients.delete(ws))
    // Send ping every 30s to keep alive
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.ping()
      else clearInterval(ping)
    }, 30_000)
  })
  console.log('[ws] WebSocket server ready on /ws')
}

export function broadcast(type: string, data: unknown): void {
  if (!wss) return
  const msg = JSON.stringify({ type, data })
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg)
  }
}
