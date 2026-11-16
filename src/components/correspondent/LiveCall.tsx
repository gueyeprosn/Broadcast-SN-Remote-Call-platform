'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Camera,
  CameraOff,
  Mic,
  MicOff,
  PhoneOff,
  Radio,
  Volume2,
  WifiOff,
} from 'lucide-react'
import { Badge, Button, Notice } from '@/components/ui'
import { cn } from '@/lib/cn'
import { normalizeMetrics, type EngineMessage } from '@/lib/media/iframe-bridge'
import { useAppEvents, useOnlineStatus } from '@/components/useAppEvents'
import { useIframeBridge } from '@/components/useIframeBridge'

export interface JoinPayload {
  publisherUrl: string
  returnUrl: string
  engineOrigin: string
  participant: {
    id: string
    displayName: string
    onAir: boolean
    micAllowed: boolean
    cameraAllowed: boolean
  }
  session: { id: string; name: string; productionName: string }
}

interface DirectorMessage {
  text: string
  at: string
}

export function LiveCall({ payload, onLeave }: { payload: JoinPayload; onLeave: () => void }) {
  const publisherRef = useRef<HTMLIFrameElement | null>(null)
  const returnRef = useRef<HTMLIFrameElement | null>(null)

  const [onAir, setOnAir] = useState(payload.participant.onAir)
  const [micAllowed, setMicAllowed] = useState(payload.participant.micAllowed)
  const [cameraAllowed, setCameraAllowed] = useState(payload.participant.cameraAllowed)
  const [micOn, setMicOn] = useState(payload.participant.micAllowed)
  const [cameraOn, setCameraOn] = useState(payload.participant.cameraAllowed)
  const [returnVolume, setReturnVolume] = useState(100)
  const [messages, setMessages] = useState<DirectorMessage[]>([])
  const [talkback, setTalkback] = useState(false)
  const [revoked, setRevoked] = useState<string | null>(null)
  const [quality, setQuality] = useState<{
    kbps: number | null
    loss: number | null
    rtt: number | null
  }>({ kbps: null, loss: null, rtt: null })

  // L'état réseau est lu comme un magasin externe : pas de `setState` au montage.
  const online = useOnlineStatus()

  const sendToPublisher = useIframeBridge(
    publisherRef,
    payload.engineOrigin,
    useCallback((message: EngineMessage) => {
      if (message.kind === 'chat') {
        setMessages((previous) =>
          [{ text: message.text, at: new Date().toISOString() }, ...previous].slice(0, 8),
        )
      }
      if (message.kind === 'stats') {
        const first = Object.values(message.inbound)[0]
        const metrics = normalizeMetrics(first)
        setQuality({
          kbps: metrics.videoKbps,
          loss: metrics.packetLossPct,
          rtt: metrics.rttMs,
        })
      }
    }, []),
  )

  const sendToReturn = useIframeBridge(
    returnRef,
    payload.engineOrigin,
    useCallback(() => undefined, []),
  )

  useEffect(() => {
    const timer = setInterval(() => sendToPublisher({ getStats: true }), 3000)
    return () => clearInterval(timer)
  }, [sendToPublisher])

  // ── Événements applicatifs ────────────────────────────────────────────────
  const sse = useAppEvents(
    payload.session.id,
    useCallback(
      (event) => {
        switch (event.type) {
          case 'participant.onair':
            setOnAir(event.onAir)
            break
          case 'participant.permissions':
            setMicAllowed(event.micAllowed)
            setCameraAllowed(event.cameraAllowed)
            if (!event.micAllowed) setMicOn(false)
            if (!event.cameraAllowed) setCameraOn(false)
            break
          case 'director.message':
            setMessages((previous) =>
              [{ text: event.text, at: event.at }, ...previous].slice(0, 8),
            )
            break
          case 'talkback.state':
            setTalkback(event.open)
            break
          case 'participant.revoked':
            setRevoked(event.reason)
            sendToPublisher({ close: true })
            break
          case 'session.state':
            if (event.state === 'ENDED') {
              setRevoked('La régie a terminé l’émission.')
              sendToPublisher({ close: true })
            }
            break
          default:
            break
        }
      },
      [sendToPublisher],
    ),
  )

  // Signale l'état LIVE une fois les iframes chargées.
  useEffect(() => {
    const timer = setTimeout(() => {
      void fetch('/api/participants/me/state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state: 'LIVE' }),
      }).catch(() => undefined)
    }, 4000)
    return () => clearTimeout(timer)
  }, [])

  function toggleMic() {
    if (!micAllowed) return
    const next = !micOn
    setMicOn(next)
    sendToPublisher({ mic: next })
  }

  function toggleCamera() {
    if (!cameraAllowed) return
    const next = !cameraOn
    setCameraOn(next)
    sendToPublisher({ camera: next })
  }

  function changeVolume(value: number) {
    setReturnVolume(value)
    sendToReturn({ volume: value })
  }

  async function leave() {
    sendToPublisher({ close: true })
    await fetch('/api/participants/me/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: 'DISCONNECTED' }),
    }).catch(() => undefined)
    onLeave()
  }

  if (revoked) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-4 text-center">
          <Notice tone="crit" title="Liaison terminée">
            {revoked}
          </Notice>
          <p className="text-xs text-txt2">
            Vous pouvez fermer cette page. Si c&apos;est une erreur, contactez la régie.
          </p>
        </div>
      </main>
    )
  }

  const lossTone = quality.loss === null ? 'neutral' : quality.loss > 3 ? 'crit' : quality.loss > 1 ? 'warn' : 'ok'

  return (
    <div className="flex min-h-screen flex-col bg-bg">
      {/* ── Bandeau d'état : la seule information vitale pour l'intervenant ── */}
      <header
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 px-3 py-2 transition-colors duration-120',
          onAir ? 'bg-onair text-white' : 'bg-surface text-txt',
        )}
      >
        <div className="flex items-center gap-2">
          {onAir ? (
            <>
              <Radio size={16} className="animate-pulseSoft" />
              <span className="text-sm font-bold uppercase tracking-wider">À l&apos;antenne</span>
            </>
          ) : (
            <>
              <Radio size={16} className="text-txt2" />
              <span className="text-sm font-semibold uppercase tracking-wider text-txt2">
                Standby
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {!online && (
            <Badge tone="crit" pulse>
              <WifiOff size={9} /> Hors ligne
            </Badge>
          )}
          {sse !== 'open' && online && <Badge tone="warn">Régie : lien faible</Badge>}
          <Badge tone={lossTone}>
            {quality.loss === null ? 'réseau —' : `pertes ${quality.loss.toFixed(1)} %`}
          </Badge>
        </div>
      </header>

      {talkback && (
        <div className="shrink-0 bg-accent px-3 py-1.5 text-center text-xs font-semibold uppercase tracking-wider text-bg">
          <Volume2 size={13} className="mr-1 inline" />
          La régie vous parle en privé
        </div>
      )}

      {!online && (
        <div className="p-3">
          <Notice tone="crit" title="Connexion perdue">
            Votre appareil n&apos;a plus de réseau. La liaison reprendra peut-être seule ;
            si l&apos;image ne revient pas au bout de quelques secondes,{' '}
            <strong className="text-txt">rechargez cette page</strong> — la reconnexion
            automatique n&apos;est pas garantie.
          </Notice>
        </div>
      )}

      {/* ── Retour programme en grand : c'est ce que l'intervenant regarde ── */}
      <div className="relative min-h-0 flex-1 bg-black">
        <iframe
          ref={returnRef}
          src={payload.returnUrl}
          title="Retour programme"
          allow="autoplay"
          className="h-full w-full border-0"
        />
        <p className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-2xs uppercase tracking-wider text-white/80">
          Retour régie
        </p>

        {/* Prévisualisation locale : l'iframe de publication, en incrustation. */}
        <div className="absolute bottom-2 right-2 w-32 overflow-hidden rounded border border-line/70 bg-black shadow-panel sm:w-44">
          <iframe
            ref={publisherRef}
            src={payload.publisherUrl}
            title="Votre caméra"
            allow="camera; microphone; autoplay"
            className="aspect-video w-full border-0"
          />
        </div>
      </div>

      {/* ── Messages de la régie ──────────────────────────────────────────── */}
      {messages.length > 0 && (
        <div className="shrink-0 space-y-1 border-t border-line/70 bg-surface2/50 p-2">
          {messages.slice(0, 3).map((message, index) => (
            <p
              key={`${message.at}-${index}`}
              className={cn(
                'rounded px-2 py-1 text-sm',
                index === 0 ? 'bg-accent/15 text-txt' : 'text-txt2',
              )}
            >
              <time className="mr-2 tabular text-2xs text-txt2">
                {new Date(message.at).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </time>
              {message.text}
            </p>
          ))}
        </div>
      )}

      {/* ── Commandes ─────────────────────────────────────────────────────── */}
      <footer className="shrink-0 space-y-2 border-t border-line/70 bg-surface p-3">
        <div className="flex items-center justify-between gap-2">
          <Button
            variant={micOn ? 'secondary' : 'danger'}
            className="h-12 flex-1"
            disabled={!micAllowed}
            onClick={toggleMic}
            title={micAllowed ? undefined : 'Micro coupé par la régie'}
          >
            {micOn ? <Mic size={16} /> : <MicOff size={16} />}
            <span className="ml-1 text-xs">{micOn ? 'Micro actif' : 'Micro coupé'}</span>
          </Button>

          <Button
            variant={cameraOn ? 'secondary' : 'danger'}
            className="h-12 flex-1"
            disabled={!cameraAllowed}
            onClick={toggleCamera}
            title={cameraAllowed ? undefined : 'Caméra coupée par la régie'}
          >
            {cameraOn ? <Camera size={16} /> : <CameraOff size={16} />}
            <span className="ml-1 text-xs">{cameraOn ? 'Caméra active' : 'Caméra coupée'}</span>
          </Button>

          <Button
            variant="danger"
            className="h-12"
            onClick={() => {
              if (onAir) {
                if (!window.confirm('Vous êtes À L’ANTENNE. Quitter quand même ?')) return
              }
              void leave()
            }}
          >
            <PhoneOff size={16} />
          </Button>
        </div>

        {(!micAllowed || !cameraAllowed) && (
          <p className="text-2xs text-warn">
            {!micAllowed && 'Votre micro a été coupé par la régie. '}
            {!cameraAllowed && 'Votre caméra a été coupée par la régie.'}
          </p>
        )}

        <label className="block space-y-0.5">
          <span className="metric-label">Volume du retour régie · {returnVolume} %</span>
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={returnVolume}
            onChange={(e) => changeVolume(Number(e.target.value))}
            className="w-full accent-[#FF9B26]"
          />
        </label>
      </footer>
    </div>
  )
}
