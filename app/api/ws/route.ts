// that works in the Next.js runtime instead of trying to upgrade connections

import { NextRequest, NextResponse } from 'next/server'

// In-memory store for signaling messages
const signalingStore: Map<
  string,
  {
    type: 'offer' | 'answer' | 'ice-candidate'
    from: string
    to: string
    data: any
  }[]
> = new Map()

const clients: Map<string, { type: 'broadcaster' | 'viewer'; lastSeen: number }> = new Map()
let broadcaster: { id: string; registeredAt: number } | null = null

// Cleanup old clients every 30 seconds
setInterval(() => {
  const now = Date.now()
  const timeout = 45000 // 45 seconds

  clients.forEach((client, id) => {
    if (now - client.lastSeen > timeout) {
      clients.delete(id)
      signalingStore.delete(id)

      if (broadcaster?.id === id) {
        broadcaster = null
        // Notify all viewers that broadcaster left
        clients.forEach((c, cId) => {
          if (c.type === 'viewer') {
            if (!signalingStore.has(cId)) signalingStore.set(cId, [])
            signalingStore.get(cId)!.push({
              type: 'offer' as const,
              from: 'broadcaster',
              to: cId,
              data: { type: 'broadcaster-left' },
            })
          }
        })
      }
    }
  })
}, 30000)

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { action, clientId, clientType, message } = body

    if (!clientId) {
      return NextResponse.json({ error: 'Missing clientId' }, { status: 400 })
    }

    if (action === 'register') {
      // Register client as broadcaster or viewer
      clients.set(clientId, { type: clientType, lastSeen: Date.now() })

      if (clientType === 'broadcaster') {
        broadcaster = { id: clientId, registeredAt: Date.now() }
        console.log('Broadcaster registered:', clientId)
      } else {
        console.log('Viewer registered:', clientId)
      }

      return NextResponse.json({
        success: true,
        broadcasterConnected: !!broadcaster,
      })
    }

    if (action === 'heartbeat') {
      // Update last seen time to keep connection alive
      const client = clients.get(clientId)
      if (client) {
        client.lastSeen = Date.now()
      }
      return NextResponse.json({ success: true })
    }

    if (action === 'send-message') {
      // Send signaling message to another client
      const { to, messageData } = message

      if (!signalingStore.has(to)) {
        signalingStore.set(to, [])
      }

      signalingStore.get(to)!.push({
        type: messageData.type,
        from: clientId,
        to: to,
        data: messageData,
      })

      return NextResponse.json({ success: true })
    }

    if (action === 'get-messages') {
      // Retrieve pending messages for this client
      const messages = signalingStore.get(clientId) || []
      signalingStore.delete(clientId)

      const client = clients.get(clientId)
      if (client) {
        client.lastSeen = Date.now()
      }

      let viewerCount = 0
      clients.forEach((c) => {
        if (c.type === 'viewer') viewerCount++
      })

      return NextResponse.json({
        messages,
        broadcasterConnected: !!broadcaster,
        broadcasterClientId: broadcaster?.id,
        viewerCount,
      })
    }

    if (action === 'get-viewers') {
      // Get list of connected viewers for broadcaster
      const viewers: string[] = []
      clients.forEach((c, id) => {
        if (c.type === 'viewer') viewers.push(id)
      })
      return NextResponse.json({ viewers })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    console.error('Signaling server error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
