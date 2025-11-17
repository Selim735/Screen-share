'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AlertCircle, Loader2, Signal, Maximize, Minimize, Volume2, VolumeX } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface ViewerViewProps {
  onBack: () => void
}

type VideoQuality = 'auto' | '480p' | '720p' | '1080p'

const QUALITY_OPTIONS: Record<VideoQuality, { label: string; width: number; height: number }> = {
  auto: { label: 'Auto', width: 0, height: 0 },
  '480p': { label: '480p', width: 854, height: 480 },
  '720p': { label: '720p', width: 1280, height: 720 },
  '1080p': { label: '1080p', width: 1920, height: 1080 },
}

export default function ViewerView({ onBack }: ViewerViewProps) {
  const [isConnecting, setIsConnecting] = useState(false)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [isMuted, setIsMuted] = useState(false)
  const [selectedQuality, setSelectedQuality] = useState<VideoQuality>('auto')
  const [volume, setVolume] = useState(100)
  
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null)
  const viewerIdRef = useRef<string>(Math.random().toString(36).substring(7))
  const signalingIntervalRef = useRef<number | null>(null)

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      disconnect()
    }
  }, [])

  // Update video quality when changed
  useEffect(() => {
    if (videoRef.current && selectedQuality !== 'auto') {
      const quality = QUALITY_OPTIONS[selectedQuality]
      videoRef.current.style.maxWidth = `${quality.width}px`
      videoRef.current.style.maxHeight = `${quality.height}px`
    } else if (videoRef.current) {
      videoRef.current.style.maxWidth = '100%'
      videoRef.current.style.maxHeight = '100%'
    }
  }, [selectedQuality])

  // Update volume
  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.volume = volume / 100
    }
  }, [volume])

  const connectSignaling = () => {
    try {
      // Register as viewer
      fetch('/api/ws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'register',
          clientId: viewerIdRef.current,
          clientType: 'viewer',
        }),
      }).catch((err) => {
        console.error('Failed to register:', err)
        setError('Failed to connect to signaling server')
      })

      // Start polling for messages
      signalingIntervalRef.current = window.setInterval(async () => {
        try {
          const response = await fetch('/api/ws', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'get-messages',
              clientId: viewerIdRef.current,
            }),
          })

          if (!response.ok) return

          const data = await response.json()

          for (const message of data.messages || []) {
            if (message.data?.type === 'broadcaster-left') {
              setError('Broadcaster disconnected')
              disconnect()
              return
            }

            if (message.type === 'offer' && message.data?.offer) {
              try {
                if (!peerConnectionRef.current) {
                  const pc = new RTCPeerConnection({
                    iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
                  })

                  pc.ontrack = (event) => {
                    console.log('Received remote track:', event.track.kind)
                    if (videoRef.current) {
                      videoRef.current.srcObject = event.streams[0]
                      // Ensure audio is enabled
                      videoRef.current.muted = isMuted
                    }
                  }

                  pc.onicecandidate = (event) => {
                    if (event.candidate) {
                      fetch('/api/ws', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          action: 'send-message',
                          clientId: viewerIdRef.current,
                          message: {
                            to: message.from,
                            messageData: {
                              type: 'ice-candidate',
                              candidate: event.candidate,
                            },
                          },
                        }),
                      }).catch((err) =>
                        console.error('Error sending ICE candidate:', err)
                      )
                    }
                  }

                  peerConnectionRef.current = pc
                }

                await peerConnectionRef.current.setRemoteDescription(
                  new RTCSessionDescription(message.data.offer)
                )

                const answer = await peerConnectionRef.current.createAnswer()
                await peerConnectionRef.current.setLocalDescription(answer)

                fetch('/api/ws', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    action: 'send-message',
                    clientId: viewerIdRef.current,
                    message: {
                      to: message.from,
                      messageData: {
                        type: 'answer',
                        answer: answer,
                      },
                    },
                  }),
                }).catch((err) => console.error('Error sending answer:', err))

                setIsConnected(true)
                setError(null)
              } catch (err) {
                console.error('Error handling offer:', err)
                setError('Failed to establish connection')
              }
            } else if (message.type === 'ice-candidate' && message.data?.candidate) {
              if (peerConnectionRef.current) {
                try {
                  await peerConnectionRef.current.addIceCandidate(
                    new RTCIceCandidate(message.data.candidate)
                  )
                } catch (err) {
                  console.error('Error adding ICE candidate:', err)
                }
              }
            }
          }
        } catch (err) {
          console.error('Polling error:', err)
        }
      }, 1000)
    } catch (err: any) {
      console.error('Signaling connection error:', err)
      setError('Failed to connect to server')
    }
  }

  const connect = async () => {
    try {
      setError(null)
      setIsConnecting(true)
      connectSignaling()

      setTimeout(() => {
        if (!isConnected) {
          setIsConnecting(false)
        }
      }, 5000)
    } catch (err: any) {
      setError(err.message || 'Failed to connect')
      setIsConnecting(false)
    }
  }

  const disconnect = () => {
    if (signalingIntervalRef.current) {
      clearInterval(signalingIntervalRef.current)
    }

    if (peerConnectionRef.current) {
      peerConnectionRef.current.close()
      peerConnectionRef.current = null
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setIsConnected(false)
    setIsConnecting(false)
  }

  const toggleFullscreen = async () => {
    if (!videoContainerRef.current) return

    try {
      if (!document.fullscreenElement) {
        await videoContainerRef.current.requestFullscreen()
      } else {
        await document.exitFullscreen()
      }
    } catch (err) {
      console.error('Fullscreen error:', err)
    }
  }

  const toggleMute = () => {
    if (videoRef.current) {
      videoRef.current.muted = !isMuted
      setIsMuted(!isMuted)
    }
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4">
      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-3xl font-bold">Watch the live stream</h1>
            <p className="text-muted-foreground mt-1">
            Contact the broadcaster on the network
            </p>
          </div>
          <Button variant="outline" onClick={onBack}>
           Return
          </Button>
        </div>

        {error && (
          <Alert variant="destructive" className="mb-6">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="space-y-4">
          {/* Video Player */}
          <div 
            ref={videoContainerRef}
            className="relative bg-black rounded-lg aspect-video overflow-hidden group"
          >
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted={isMuted}
              className="w-full h-full object-contain"
            />
            
            {/* Video Controls Overlay */}
            {isConnected && (
              <div className="absolute inset-0 bg-linear-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                <div className="w-full flex items-center justify-between gap-4">
                  {/* Left Controls */}
                  <div className="flex items-center gap-2">
                    {/* Mute/Unmute Button */}
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={toggleMute}
                      className="flex items-center gap-2"
                    >
                      {isMuted ? (
                        <VolumeX className="h-4 w-4" />
                      ) : (
                        <Volume2 className="h-4 w-4" />
                      )}
                    </Button>

                    {/* Volume Slider */}
                    {!isMuted && (
                      <input
                        type="range"
                        min="0"
                        max="100"
                        value={volume}
                        onChange={(e) => setVolume(Number(e.target.value))}
                        className="w-24 h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer"
                        style={{
                          background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${volume}%, #4b5563 ${volume}%, #4b5563 100%)`
                        }}
                      />
                    )}
                  </div>

                  {/* Right Controls */}
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={toggleFullscreen}
                    className="flex items-center gap-2"
                  >
                    {isFullscreen ? (
                      <>
                        <Minimize className="h-4 w-4" />
                       Exit full screen
                      </>
                    ) : (
                      <>
                        <Maximize className="h-4 w-4" />
                       Full screen
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* Quality Selection */}
          {isConnected && (
            <div className="space-y-2">
              <label className="text-sm font-medium">Video quality</label>
              <div className="grid grid-cols-4 gap-2">
                {(Object.entries(QUALITY_OPTIONS) as Array<[VideoQuality, typeof QUALITY_OPTIONS[VideoQuality]]>).map(
                  ([quality, config]) => (
                    <button
                      key={quality}
                      onClick={() => setSelectedQuality(quality)}
                      className={`p-2 rounded-lg border-2 transition-all text-center ${
                        selectedQuality === quality
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-border bg-muted/30 hover:border-primary/50'
                      }`}
                    >
                      <p className="font-semibold text-sm">{config.label}</p>
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {/* Connection Buttons */}
          <div className="flex gap-3">
            <Button
              onClick={connect}
              disabled={isConnecting || isConnected}
              className="flex-1 h-11"
            >
              {isConnecting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                 Connecting...
                </>
              ) : isConnected ? (
                <>
                  <Signal className="h-4 w-4 mr-2" />
                 connected
                </>
              ) : (
                'Connect to the broadcast'
              )}
            </Button>

            {isConnected && (
              <Button
                onClick={disconnect}
                variant="destructive"
                className="flex-1 h-11"
              >
               disconnect
              </Button>
            )}
          </div>

          {/* Info Text */}
          {!isConnected && (
            <div className="bg-accent/5 border border-accent/20 p-4 rounded-lg">
              <p className="text-sm text-muted-foreground text-center">
               Click "Connect to broadcast" to start viewing the shared screen
              </p>
            </div>
          )}
        </div>
      </Card>
    </div>
  )
}