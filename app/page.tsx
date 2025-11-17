'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Monitor, Eye } from 'lucide-react'
import BroadcasterView from '@/components/broadcaster-view'
import ViewerView from '@/components/viewer-view'

export default function Home() {
  const [role, setRole] = useState<'selector' | 'broadcaster' | 'viewer'>('selector')

  return (
    <main className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background via-background to-accent/5 p-4">
      {role === 'selector' && (
        <Card className="w-full max-w-md border border-border/50 shadow-lg">
          <div className="p-8 space-y-8">
            <div className="text-center space-y-3">
              <div className="flex justify-center">
                <div className="bg-primary/10 border border-primary/20 rounded-lg p-3">
                  <Monitor className="h-8 w-8 text-primary" />
                </div>
              </div>
              <div>
                <h1 className="text-3xl font-bold">Screen Share</h1>
                <p className="text-muted-foreground text-sm mt-2">
                  Stream your screen to devices on the local network via WebRTC
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <Button
                onClick={() => setRole('broadcaster')}
                className="w-full h-12 text-base font-semibold"
              >
                <Monitor className="h-5 w-5 mr-2" />
                Share My Screen
              </Button>

              <Button
                onClick={() => setRole('viewer')}
                variant="outline"
                className="w-full h-12 text-base font-semibold"
              >
                <Eye className="h-5 w-5 mr-2" />
                Watch Stream
              </Button>
            </div>

            <div className="text-xs text-muted-foreground text-center bg-muted/50 p-3 rounded">
              Streams are sent directly between devices on your network. No internet required.
            </div>
          </div>
        </Card>
      )}

      {role === 'broadcaster' && <BroadcasterView onBack={() => setRole('selector')} />}
      {role === 'viewer' && <ViewerView onBack={() => setRole('selector')} />}
    </main>
  )
}
