'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { AlertCircle, Wifi, Users, Volume2, Maximize, Minimize, Mic, MicOff } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'

interface BroadcasterViewProps {
  onBack: () => void
}

type QualityLevel = 'low' | 'medium' | 'high' | 'original'

interface QualitySettings {
  name: string
  description: string
  width: number
  height: number
  frameRate: number
  bitrate: number
}

const QUALITY_PRESETS: Record<QualityLevel, QualitySettings> = {
  low: {
    name: 'Low',
    description: '720p @ 15fps',
    width: 1280,
    height: 720,
    frameRate: 15,
    bitrate: 1000000, // 1 Mbps
  },
  medium: {
    name: 'Medium',
    description: '1080p @ 24fps (Default)',
    width: 1920,
    height: 1080,
    frameRate: 24,
    bitrate: 3000000, // 3 Mbps
  },
  high: {
    name: 'High',
    description: '1080p @ 30fps',
    width: 1920,
    height: 1080,
    frameRate: 30,
    bitrate: 5000000, // 5 Mbps
  },
  original: {
    name: 'Original',
    description: '2K @ 30fps (Max)',
    width: 2560,
    height: 1440,
    frameRate: 30,
    bitrate: 8000000, // 8 Mbps
  },
}

export default function BroadcasterView({ onBack }: BroadcasterViewProps) {
  const [isSharing, setIsSharing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [viewers, setViewers] = useState(0)
  const [localIp, setLocalIp] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [selectedQuality, setSelectedQuality] = useState<QualityLevel>('medium')
  const [includeAudio, setIncludeAudio] = useState(true)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const videoContainerRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const broadcasterIdRef = useRef<string | null>(null)
  const signalingIntervalRef = useRef<number | null>(null)

  useEffect(() => {
    broadcasterIdRef.current = Math.random().toString(36).substring(7)
    getLocalIp()
    connectSignaling()

    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
    }

    document.addEventListener('fullscreenchange', handleFullscreenChange)

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange)
      if (signalingIntervalRef.current) {
        clearInterval(signalingIntervalRef.current)
      }
      stopSharing()
    }
  }, [])

  const getLocalIp = async () => {
    try {
      const response = await fetch('/api/ip')
      const data = await response.json()
      setLocalIp(data.ip)
      console.log('Local IP:', data.ip)
    } catch (err) {
      console.error('Failed to get local IP:', err)
    }
  }

  const connectSignaling = () => {
    setWsConnected(true)
    setError(null)

    // Register as broadcaster
    fetch('/api/ws', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'register',
        clientId: broadcasterIdRef.current,
        clientType: 'broadcaster',
      }),
    }).catch((err) => {
      console.error('Failed to register:', err)
      setError('Failed to connect to signaling server')
    })

    // Start polling for messages and heartbeat
    signalingIntervalRef.current = window.setInterval(async () => {
      try {
        const response = await fetch('/api/ws', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'get-messages',
            clientId: broadcasterIdRef.current,
          }),
        })

        if (!response.ok) {
          setWsConnected(false)
          return
        }

        const data = await response.json()

        // Update viewer count
        if (data.viewerCount !== undefined) {
          setViewers(data.viewerCount)
        }

        // Handle incoming messages
        for (const message of data.messages || []) {
          if (message.type === 'answer' && message.data?.type !== 'broadcaster-left') {
            try {
              const peerConnection = peerConnectionsRef.current.get(message.from)
              if (peerConnection && message.data?.answer) {
                await peerConnection.setRemoteDescription(
                  new RTCSessionDescription(message.data.answer)
                )
              }
            } catch (err) {
              console.error('Error handling answer:', err)
            }
          } else if (message.type === 'ice-candidate' && message.data?.candidate) {
            try {
              const peerConnection = peerConnectionsRef.current.get(message.from)
              if (peerConnection) {
                await peerConnection.addIceCandidate(
                  new RTCIceCandidate(message.data.candidate)
                )
              }
            } catch (err) {
              console.error('Error adding ICE candidate:', err)
            }
          }
        }

        // Check if there are new viewers
        const viewersResponse = await fetch('/api/ws', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'get-viewers',
            clientId: broadcasterIdRef.current,
          }),
        })

        if (viewersResponse.ok) {
          const viewersData = await viewersResponse.json()
          const existingViewers = peerConnectionsRef.current.keys()

          for (const viewerId of viewersData.viewers) {
            if (!peerConnectionsRef.current.has(viewerId)) {
              await createPeerConnectionForViewer(viewerId)
            }
          }
        }
      } catch (err) {
        console.error(' Polling error:', err)
      }
    }, 1000)
  }

  const createPeerConnectionForViewer = async (viewerId: string) => {
    if (!streamRef.current) return

    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [{ urls: ['stun:stun.l.google.com:19302'] }],
      })

      peerConnectionsRef.current.set(viewerId, peerConnection)
      setViewers(peerConnectionsRef.current.size)

      streamRef.current.getTracks().forEach((track) => {
        peerConnection.addTrack(track, streamRef.current!)
      })

      peerConnection.onicecandidate = (event) => {
        if (event.candidate) {
          fetch('/api/ws', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'send-message',
              clientId: broadcasterIdRef.current,
              message: {
                to: viewerId,
                messageData: {
                  type: 'ice-candidate',
                  candidate: event.candidate,
                },
              },
            }),
          }).catch((err) => console.error(' Error sending ICE candidate:', err))
        }
      }

      const offer = await peerConnection.createOffer()
      await peerConnection.setLocalDescription(offer)

      fetch('/api/ws', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send-message',
          clientId: broadcasterIdRef.current,
          message: {
            to: viewerId,
            messageData: {
              type: 'offer',
              offer: offer,
            },
          },
        }),
      }).catch((err) => console.error(' Error sending offer:', err))

      console.log('Peer connection created for viewer:', viewerId)
    } catch (err) {
      console.error('Error creating peer connection:', err)
    }
  }

  const startSharing = async () => {
    try {
      setError(null)
      const quality = QUALITY_PRESETS[selectedQuality]
      
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          width: { ideal: quality.width },
          height: { ideal: quality.height },
          frameRate: { ideal: quality.frameRate },
        },
        audio: includeAudio ? true : false,
      })

      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
      setIsSharing(true)

      const videoTrack = stream.getVideoTracks()[0]
      if (videoTrack) {
        const sender = Array.from(peerConnectionsRef.current.values())
          .flatMap(pc => pc.getSenders())
          .find(s => s.track === videoTrack)
        
        if (sender) {
          const params = sender.getParameters()
          params.encodings[0].maxBitrate = quality.bitrate
          await sender.setParameters(params).catch(() => {})
        }
      }

      videoTrack.onended = () => {
        stopSharing()
      }
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        setError(err.message || 'Failed to start screen share')
      }
      console.error('Screen capture error:', err)
    }
  }

  const stopSharing = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    peerConnectionsRef.current.forEach((pc) => pc.close())
    peerConnectionsRef.current.clear()

    if (videoRef.current) {
      videoRef.current.srcObject = null
    }

    setIsSharing(false)
    setViewers(0)
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

  return (
    <div className="w-full max-w-6xl mx-auto px-4">
      <div className="space-y-4">
        <Card className="p-6">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold">Broadcasting Screen</h1>
              <p className="text-muted-foreground mt-1">
                Share your screen with viewers on the local network
              </p>
            </div>
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
          </div>

          {error && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          {isSharing ? (
            <div className="space-y-6">
              <div ref={videoContainerRef} className="relative bg-black rounded-lg aspect-video overflow-hidden group">
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  className="w-full h-full object-cover"
                />
                
                {/* Video controls overlay */}
                <div className="absolute inset-0 bg-linear-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end justify-between p-4">
                  <div className="text-white text-sm font-medium">
                    {QUALITY_PRESETS[selectedQuality].description}
                    {includeAudio && ' + Audio'}
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={toggleFullscreen}
                    className="flex items-center gap-2"
                  >
                    {isFullscreen ? (
                      <>
                        <Minimize className="h-4 w-4" />
                        Exit Fullscreen
                      </>
                    ) : (
                      <>
                        <Maximize className="h-4 w-4" />
                        Fullscreen
                      </>
                    )}
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-4">
                  {/* Share Link Section */}
                  <div className="bg-accent/10 border border-accent/20 p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-4">
                      <Wifi className="h-5 w-5 text-accent" />
                      <span className="font-semibold">Share Link</span>
                    </div>
                    <div className="space-y-3 text-sm">
                      <div className="bg-background p-2 rounded border border-border">
                        {localIp ? (
                          <p className="font-mono text-xs text-primary break-all">
                            http://{localIp}:3000
                          </p>
                        ) : (
                          <p className="text-muted-foreground">Getting IP...</p>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground text-center">
                        Share this URL with viewers
                      </p>
                    </div>
                  </div>
                </div>

                {/* Viewers and Controls Section */}
                <div className="space-y-4">
                  <div className="bg-primary/10 border border-primary/20 p-4 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <Users className="h-5 w-5 text-primary" />
                      <span className="font-semibold">Connected Viewers</span>
                    </div>
                    <p className="text-3xl font-bold text-primary">{viewers}</p>
                  </div>

                  <Button
                    onClick={stopSharing}
                    variant="destructive"
                    className="w-full h-10"
                  >
                    Stop Sharing
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Quality Selection */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Streaming Quality</label>
                <div className="grid grid-cols-2 gap-2">
                  {(Object.entries(QUALITY_PRESETS) as Array<[QualityLevel, QualitySettings]>).map(
                    ([level, preset]) => (
                      <button
                        key={level}
                        onClick={() => setSelectedQuality(level)}
                        className={`p-3 rounded-lg border-2 transition-all text-left ${
                          selectedQuality === level
                            ? 'border-primary bg-primary/10'
                            : 'border-border bg-muted/30 hover:border-primary/50'
                        }`}
                      >
                        <p className="font-semibold text-sm">{preset.name}</p>
                        <p className="text-xs text-muted-foreground">{preset.description}</p>
                      </button>
                    )
                  )}
                </div>
              </div>

              {/* Audio Sharing Option */}
              <div className="space-y-2">
                <label className="text-sm font-medium">Audio Settings</label>
                <div className="flex items-center gap-3 p-4 bg-accent/5 border border-accent/20 rounded-lg">
                  <button
                    onClick={() => setIncludeAudio(!includeAudio)}
                    className={`flex-1 flex items-center justify-center gap-2 p-3 rounded-lg border-2 transition-all ${
                      includeAudio
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border bg-muted/30 text-muted-foreground'
                    }`}
                  >
                    {includeAudio ? (
                      <>
                        <Volume2 className="h-4 w-4" />
                        Audio Enabled
                      </>
                    ) : (
                      <>
                        <MicOff className="h-4 w-4" />
                        Audio Disabled
                      </>
                    )}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Enable audio to share system sound and microphone with viewers
                </p>
              </div>

              {/* Quality Tips */}
              <div className="bg-accent/5 border border-accent/20 p-4 rounded-lg space-y-2">
                <div className="flex items-start gap-2">
                  <Volume2 className="h-4 w-4 text-accent mt-0.5" />
                  <div className="text-sm space-y-1">
                    <p className="font-medium">Quality Tips:</p>
                    <ul className="text-xs text-muted-foreground space-y-0.5">
                      <li>• <span className="font-medium">Low:</span> For slow networks</li>
                      <li>• <span className="font-medium">Medium:</span> Recommended (balanced)</li>
                      <li>• <span className="font-medium">High:</span> For smooth, clear streaming</li>
                      <li>• <span className="font-medium">Original:</span> Requires strong network</li>
                    </ul>
                  </div>
                </div>
              </div>

              <Button
                onClick={startSharing}
                disabled={!wsConnected}
                className="w-full h-12 text-base"
              >
                {wsConnected ? 'Start Screen Share' : 'Connecting...'}
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
