import { NextRequest, NextResponse } from 'next/server'
import { networkInterfaces } from 'os'

export async function GET(request: NextRequest) {
  try {
    const interfaces = networkInterfaces()
    let ip = 'localhost'

    for (const name of Object.keys(interfaces)) {
      const iface = interfaces[name]
      if (iface) {
        for (const addr of iface) {
          if (addr.family === 'IPv4' && !addr.internal) {
            ip = addr.address
            break
          }
        }
      }
      if (ip !== 'localhost') break
    }

    return NextResponse.json({ ip })
  } catch (error) {
    console.error('Error getting IP:', error)
    return NextResponse.json({ ip: 'localhost' })
  }
}
