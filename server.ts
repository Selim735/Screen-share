// server.ts - Place this in your project root
import { createServer } from 'http'
import { parse } from 'url'
import next from 'next'
import { WebSocketServer, WebSocket } from 'ws'

const dev = process.env.NODE_ENV !== 'production'
const hostname = 'localhost'
const port = 3000

const app = next({ dev, hostname, port })
const handle = app.getRequestHandler()

interface Client {
  id: string
  type: 'broadcaster' | 'viewer'
  ws: WebSocket
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parse(req.url!, true)
      await handle(req, res, parsedUrl)
    } catch (err) {
      console.error('Error occurred handling', req.url, err)
      res.statusCode = 500
      res.end('internal server error')
    }
  })

  // WebSocket server
  const wss = new WebSocketServer({ noServer: true })
  
  const clients = new Map<string, Client>()
  let broadcaster: Client | null = null

  wss.on('connection', (ws: WebSocket) => {
    const clientId = Math.random().toString(36).substring(7)
    const client: Client = { id: clientId, type: 'viewer', ws }

    console.log('[WebSocket] Client connected:', clientId)

    ws.on('message', (data: Buffer) => {
      try {
        const message = JSON.parse(data.toString())

        if (message.type === 'broadcaster-join') {
          client.type = 'broadcaster'
          broadcaster = client
          clients.set(clientId, client)
          console.log('[WebSocket] Broadcaster joined:', clientId)
        } 
        else if (message.type === 'viewer-join') {
          client.type = 'viewer'
          clients.set(clientId, client)
          console.log('[WebSocket] Viewer joined:', message.viewerId)

          if (broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
            broadcaster.ws.send(JSON.stringify({
              type: 'viewer-join',
              viewerId: message.viewerId,
            }))
          }
        } 
        else if (message.type === 'offer') {
          const targetClient = Array.from(clients.values()).find(
            c => c.type === 'viewer' && message.to.includes(c.id)
          )
          if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
            targetClient.ws.send(JSON.stringify(message))
          }
        } 
        else if (message.type === 'answer') {
          if (broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
            broadcaster.ws.send(JSON.stringify(message))
          }
        } 
        else if (message.type === 'ice-candidate') {
          if (message.to === 'broadcaster' && broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
            broadcaster.ws.send(JSON.stringify(message))
          } else {
            const targetClient = Array.from(clients.values()).find(
              c => message.to.includes(c.id)
            )
            if (targetClient && targetClient.ws.readyState === WebSocket.OPEN) {
              targetClient.ws.send(JSON.stringify(message))
            }
          }
        } 
        else if (message.type === 'viewer-left') {
          if (broadcaster && broadcaster.ws.readyState === WebSocket.OPEN) {
            broadcaster.ws.send(JSON.stringify({
              type: 'viewer-left',
              viewerId: message.viewerId,
            }))
          }
        }
      } catch (err) {
        console.error('[WebSocket] Message handling error:', err)
      }
    })

    ws.on('close', () => {
      console.log('[WebSocket] Client disconnected:', clientId)
      clients.delete(clientId)

      if (broadcaster?.id === clientId) {
        broadcaster = null
        clients.forEach((c) => {
          if (c.type === 'viewer' && c.ws.readyState === WebSocket.OPEN) {
            c.ws.close()
          }
        })
        clients.clear()
      }
    })

    ws.on('error', (error: Error) => {
      console.error('[WebSocket] Error:', error)
    })
  })

  // Handle WebSocket upgrade
  server.on('upgrade', (request, socket, head) => {
    const { pathname } = parse(request.url!, true)
    
    if (pathname === '/api/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
  })

  server.listen(port, () => {
    console.log(`> Ready on http://${hostname}:${port}`)
  })
})