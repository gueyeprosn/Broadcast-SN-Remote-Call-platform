'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  AlertTriangle,
  ChevronLeft,
  Megaphone,
  Play,
  Square,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { Badge, Button, Notice, Panel } from '@/components/ui'
import { useAppEvents } from '@/components/useAppEvents'
import { useDirectorBridge } from './useDirectorBridge'
import { CorrespondentCard, type CardActions } from './CorrespondentCard'
import { InvitePanel } from './InvitePanel'
import { VmixPanel } from './VmixPanel'
import { EventLog } from './EventLog'
import { ProgramReturnPanel } from './ProgramReturnPanel'
import type { ControlRoomProps, EventRow, ParticipantSummary } from './types'

const ALL_BUSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

export function ControlRoom(props: ControlRoomProps) {
  const router = useRouter()
  const [participants, setParticipants] = useState(props.participants)
  const [previousParticipants, setPreviousParticipants] = useState(props.participants)
  if (previousParticipants !== props.participants) {
    setPreviousParticipants(props.participants)
    setParticipants(props.participants)
  }
  const [events, setEvents] = useState<EventRow[]>(props.initialEvents)
  const [sessionState, setSessionState] = useState(props.session.state)
  const [talkbackOn, setTalkbackOn] = useState<string | null>(null)
  const [pending, setPending] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  // Secours : bascule vers l'interface native du moteur si une commande
  // de la console cessait de passer en pleine émission.
  const [engineUi, setEngineUi] = useState(false)

  const capabilities = props.userCapabilities
  const may = useCallback(
    (capability: string) => capabilities.includes(capability as never),
    [capabilities],
  )

  const { frameRef, state: bridge, send } = useDirectorBridge(
    props.engineOrigin,
  )

  // ── Événements applicatifs (SSE) ───────────────────────────────────────────
  const sse = useAppEvents(
    props.session.id,
    useCallback((event) => {
      switch (event.type) {
        case 'participant.onair':
          setParticipants((list) =>
            list.map((p) =>
              p.id === event.participantId
                ? { ...p, onAir: event.onAir, onAirSource: event.source }
                : p,
            ),
          )
          break
        case 'participant.permissions':
          setParticipants((list) =>
            list.map((p) =>
              p.id === event.participantId
                ? { ...p, micAllowed: event.micAllowed, cameraAllowed: event.cameraAllowed }
                : p,
            ),
          )
          break
        case 'participant.state':
          setParticipants((list) =>
            list.map((p) =>
              p.id === event.participantId
                ? { ...p, state: event.state as ParticipantSummary['state'] }
                : p,
            ),
          )
          break
        case 'participant.quality':
          setParticipants((list) =>
            list.map((p) =>
              p.id === event.participantId
                ? { ...p, qualityProfile: event.profile as ParticipantSummary['qualityProfile'] }
                : p,
            ),
          )
          break
        case 'participant.returnbus':
          setParticipants((list) =>
            list.map((p) => (p.id === event.participantId ? { ...p, returnBus: event.bus } : p)),
          )
          break
        case 'participant.revoked':
          setParticipants((list) =>
            list.map((p) => (p.id === event.participantId ? { ...p, state: 'REVOKED' } : p)),
          )
          break
        case 'talkback.state':
          setTalkbackOn(event.open ? event.participantId : null)
          break
        case 'session.state':
          setSessionState(event.state as typeof sessionState)
          break
        default:
          break
      }
    }, []),
  )

  // La mise en forme du multiview n'est plus faite par injection de CSS : elle
  // vient des paramètres d'URL du moteur (`&previewmode` et compagnie), qui
  // sont documentés et vérifiés. L'ancienne feuille injectée visait `#main` —
  // qui est le `body` — et `#mainmenu`, qui n'existe pas : elle ne masquait
  // rien, et l'interface anglaise du moteur s'affichait par-dessus la nôtre.

  // ── Remontée périodique des mesures vers le serveur ────────────────────────
  const runtimeRef = useRef(bridge.runtime)
  useEffect(() => {
    runtimeRef.current = bridge.runtime
  }, [bridge.runtime])
  useEffect(() => {
    if (!may('metrics.read')) return
    const timer = setInterval(() => {
      for (const participant of participants) {
        const runtime = runtimeRef.current[participant.streamId]
        if (!runtime) continue
        void fetch(`/api/participants/${participant.id}/metrics`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(runtime.metrics),
        }).catch(() => undefined)
      }
    }, 10_000)
    return () => clearInterval(timer)
    // `participants` suffit : le runtime est lu par référence.
  }, [participants, may])

  // ── Synchronisation ON AIR depuis vMix, si une connexion est déclarée ──────
  const [vmixConnectionId, setVmixConnectionId] = useState<string | null>(
    props.vmixConnections[0]?.id ?? null,
  )
  const [vmixSyncEnabled, setVmixSyncEnabled] = useState(false)
  useEffect(() => {
    if (!vmixSyncEnabled || !vmixConnectionId) return
    let stop = false
    const tick = async () => {
      if (stop) return
      try {
        await fetch(`/api/vmix/connections/${vmixConnectionId}/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: props.session.id }),
        })
      } catch {
        /* l'état vMix est affiché par le panneau dédié */
      }
    }
    const timer = setInterval(tick, 2500)
    void tick()
    return () => {
      stop = true
      clearInterval(timer)
    }
  }, [vmixSyncEnabled, vmixConnectionId, props.session.id])

  // ── Actions ────────────────────────────────────────────────────────────────

  const mark = (id: string, value: boolean) =>
    setPending((previous) => ({ ...previous, [id]: value }))

  const patch = useCallback(
    async (participantId: string, body: Record<string, unknown>) => {
      mark(participantId, true)
      setError(null)
      try {
        const response = await fetch(`/api/participants/${participantId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        })
        if (!response.ok) {
          const data = (await response.json()) as { error?: { message?: string } }
          setError(data.error?.message ?? 'Commande refusée par le serveur.')
        }
      } catch {
        setError('Le serveur est injoignable. Les flux en cours ne sont pas affectés.')
      } finally {
        mark(participantId, false)
      }
    },
    [],
  )

  const actionsFor = useCallback(
    (participant: ParticipantSummary): CardActions => ({
      setOnAir: (onAir) => void patch(participant.id, { onAir }),

      setMic: (enabled) => {
        // Deux effets distincts et complémentaires :
        //  - la commande moteur coupe réellement le micro publié ;
        //  - l'enregistrement serveur garde l'autorisation, ce qui survit à un
        //    rechargement de page du correspondant.
        send({ action: 'mic', target: participant.streamId, value: enabled })
        void patch(participant.id, { micAllowed: enabled })
      },

      setCamera: (enabled) => {
        send({ action: 'camera', target: participant.streamId, value: enabled })
        void patch(participant.id, { cameraAllowed: enabled })
      },

      setVolume: (value) => {
        send({ action: 'volume', target: participant.streamId, value })
      },

      setQuality: (profile) => void patch(participant.id, { qualityProfile: profile }),

      setReturnBus: (bus) => void patch(participant.id, { returnBus: bus }),

      openTalkback: (open) => {
        if (open) {
          send({ action: 'soloChat', target: participant.streamId, value: null })
        } else {
          // Même commande : `soloChat` est une bascule côté moteur. On la
          // renvoie pour refermer, et l'état serveur tranche en cas de doute.
          send({ action: 'soloChat', target: participant.streamId, value: null })
        }
        void fetch(`/api/sessions/${props.session.id}/talkback`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            participantId: open ? participant.id : null,
            open,
            bidirectional: false,
          }),
        }).catch(() => undefined)
      },

      sendMessage: (text) => {
        send({ action: 'sendDirectorChat', target: participant.streamId, value: text })
        void fetch(`/api/participants/${participant.id}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        }).catch(() => undefined)
      },

      hangup: () => {
        send({ action: 'hangup', target: participant.streamId, value: null })
      },

      revoke: () => {
        send({ action: 'hangup', target: participant.streamId, value: null })
        void fetch(`/api/participants/${participant.id}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: 'Révoqué depuis la régie' }),
        }).then(() => router.refresh())
      },
    }),
    [patch, send, props.session.id, router],
  )

  async function changeSessionState(action: 'start' | 'end') {
    if (action === 'end') {
      const ok = window.confirm(
        'Terminer la session ?\n\n' +
          '• Tous les correspondants sont déconnectés.\n' +
          '• Tous les liens d’invitation sont révoqués.\n' +
          'Cette action n’est pas réversible.',
      )
      if (!ok) return
      // Raccrochage média avant la bascule serveur : sinon les invités restent
      // connectés au moteur alors que la session est close côté application.
      for (const participant of participants) {
        send({ action: 'hangup', target: participant.streamId, value: null })
      }
    }
    const response = await fetch(`/api/sessions/${props.session.id}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    if (!response.ok) {
      const data = (await response.json()) as { error?: { message?: string } }
      setError(data.error?.message ?? 'Changement d’état refusé.')
      return
    }
    router.refresh()
  }

  const talkbackParticipant = useMemo(
    () => participants.find((p) => p.id === talkbackOn) ?? null,
    [participants, talkbackOn],
  )

  const onAirCount = participants.filter((p) => p.onAir).length
  const returnBuses = useMemo(() => {
    const declared = props.vmixConnections.flatMap((c) => c.returnBuses)
    return declared.length > 0 ? [...new Set(declared)] : ALL_BUSES
  }, [props.vmixConnections])

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col tall:h-[calc(100dvh-3rem)]">
      {/* ── Barre supérieure ─────────────────────────────────────────────── */}
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line/70 bg-surface2/50 px-4">
        <div className="flex min-w-0 items-center gap-2">
          {/* Sortie de secours : depuis la régie, on doit pouvoir revenir à la
              liste des émissions sans passer par la barre du haut. */}
          <Link
            href="/productions"
            title="Revenir à mes émissions"
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-2xs text-txt2 transition-colors hover:bg-surface2 hover:text-txt"
          >
            <ChevronLeft size={14} />
            <span className="hidden sm:inline">Émissions</span>
          </Link>
          <div className="min-w-0 border-l border-line/70 pl-3">
            <p className="truncate text-sm font-semibold text-txt">
              {props.session.productionName}
            </p>
            <p className="truncate text-2xs text-txt2">{props.session.name}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Badge tone={onAirCount > 0 ? 'onair' : 'neutral'} pulse={onAirCount > 0}>
            {onAirCount} à l&apos;antenne
          </Badge>
          <Badge tone={bridge.directorReady ? 'ok' : 'warn'}>
            Canal régie {bridge.directorReady ? 'actif' : 'en attente'}
          </Badge>
          <Badge tone={sse === 'open' ? 'ok' : 'crit'}>
            {sse === 'open' ? <Wifi size={9} /> : <WifiOff size={9} />}
            Supervision
          </Badge>

          {sessionState !== 'LIVE' && sessionState !== 'ENDED' && may('session.write') && (
            <Button size="sm" variant="primary" onClick={() => void changeSessionState('start')}>
              <Play size={12} /> Démarrer
            </Button>
          )}
          {sessionState === 'LIVE' && may('session.end') && (
            <Button size="sm" variant="danger" onClick={() => void changeSessionState('end')}>
              <Square size={12} /> Terminer
            </Button>
          )}
          {sessionState === 'ENDED' && <Badge tone="neutral">Session terminée</Badge>}
        </div>
      </header>

      {/* ── Bandeau talkback : impossible à ignorer ──────────────────────── */}
      {talkbackParticipant && (
        <div className="flex shrink-0 items-center gap-2 bg-onair px-4 py-1.5 text-xs font-semibold uppercase tracking-wider text-white">
          <Megaphone size={14} />
          Talkback ouvert · {talkbackParticipant.displayName}
          <span className="ml-auto font-normal normal-case tracking-normal opacity-90">
            Hors antenne — ce canal n&apos;est pas routé vers le Program
          </span>
        </div>
      )}

      {error && (
        <div className="shrink-0 px-4 pt-2">
          <Notice tone="crit" title="Commande refusée">
            {error}
          </Notice>
        </div>
      )}

      {/* ── Corps ────────────────────────────────────────────────────────── */}
      <div className="grid min-h-0 flex-1 gap-3 p-3 tall:overflow-hidden xl:grid-cols-[1fr_360px]">
        <div className="flex min-h-0 flex-col gap-3 tall:overflow-auto">
          {/* Multiview — l'iframe director, déjà connectée à tous les invités. */}
          <Panel
            title="Multiview régie"
            bodyClassName="p-0"
            actions={
              <div className="flex items-center gap-2">
                <span className="text-2xs text-txt2">
                  {bridge.totals.inbound} flux entrant
                  {bridge.totals.inbound > 1 ? 's' : ''} · salle {props.session.roomName}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setEngineUi((v) => !v)}
                  title={
                    engineUi
                      ? 'Revenir au multiview'
                      : 'Afficher l’interface native du moteur — secours si une commande ne passe plus'
                  }
                >
                  {engineUi ? 'Multiview' : 'Interface moteur'}
                </Button>
              </div>
            }
            className="min-h-[220px] shrink-0"
          >
            <iframe
              ref={frameRef}
              // La clé force le remontage : changer `src` sur une iframe déjà
              // chargée ne recharge pas toujours, et le pont postMessage doit
              // de toute façon être rétabli sur le nouveau document.
              key={engineUi ? 'moteur' : 'multiview'}
              src={engineUi ? props.directorFullUrl : props.directorUrl}
              title="Canal de supervision"
              allow="camera; microphone; autoplay; display-capture"
              className="h-[min(42vh,420px)] w-full border-0 bg-black"
            />
          </Panel>

          {participants.length === 0 ? (
            <Panel title="Correspondants">
              <p className="text-sm text-txt2">
                Aucun correspondant. Ajoutez-en un dans le panneau « Invitations ».
              </p>
            </Panel>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {participants.filter((participant) => participant.state !== 'REVOKED').map((participant) => (
                <CorrespondentCard
                  key={participant.id}
                  participant={participant}
                  runtime={bridge.runtime[participant.streamId]}
                  capabilities={props.capabilities}
                  userCapabilities={props.userCapabilities}
                  qualityProfiles={props.qualityProfiles}
                  returnBuses={returnBuses}
                  talkbackOn={talkbackOn === participant.id}
                  actions={actionsFor(participant)}
                  pending={pending[participant.id] ?? false}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Colonne de droite ──────────────────────────────────────────── */}
        <div className="flex min-h-0 flex-col gap-3 tall:overflow-auto">
          <details className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm text-txt2">Retour programme</summary>
          <ProgramReturnPanel
            returnPublisherPath={props.returnPublisherPath}
            returnStreamId={props.session.returnStreamId}
            nativeMixMinus={props.capabilities.nativeMixMinus}
          />
          </details>

          <InvitePanel
            sessionId={props.session.id}
            participants={participants}
            canInvite={may('invitation.create')}
            canAdd={may('participant.write')}
            canRemove={may('invitation.revoke')}
            onRemove={async (participant) => {
              const response = await fetch(`/api/participants/${participant.id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason: 'Retiré depuis la liste des clients' }),
              })
              if (!response.ok) {
                const data = await response.json() as { error?: { message?: string } }
                throw new Error(data.error?.message ?? 'Retrait refusé.')
              }
              send({ action: 'hangup', target: participant.streamId, value: null })
              setParticipants((list) => list.filter((client) => client.id !== participant.id))
              router.refresh()
            }}
            qualityProfiles={props.qualityProfiles}
            onChanged={() => router.refresh()}
          />

          <details className="rounded-lg border border-line bg-surface p-3">
          <summary className="cursor-pointer text-sm text-txt2">Connexion vMix et réglages techniques</summary>
          <VmixPanel
            sessionId={props.session.id}
            connections={props.vmixConnections}
            participants={participants}
            selectedConnectionId={vmixConnectionId}
            onSelectConnection={setVmixConnectionId}
            syncEnabled={vmixSyncEnabled}
            onToggleSync={setVmixSyncEnabled}
            canNavigate={may('vmix.navigate')}
            canAudio={may('vmix.audio')}
            onChanged={() => router.refresh()}
          />

          <EventLog
            events={events}
            participants={participants}
            onClear={() => setEvents([])}
          />

          {!props.capabilities.guaranteedReconnect && (
            <Panel title="Limites du moteur">
              <ul className="space-y-1.5 text-2xs text-txt2">
                <li className="flex gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
                  La reconnexion automatique n&apos;est pas garantie par le moteur média.
                  Un correspondant coupé doit parfois recharger sa page.
                </li>
                <li className="flex gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0 text-warn" />
                  Le mix-minus n&apos;est pas automatique : il est construit bus par bus
                  dans vMix.
                </li>
              </ul>
            </Panel>
          )}
          </details>
        </div>
      </div>
    </div>
  )
}
