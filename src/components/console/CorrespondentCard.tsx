'use client'

import { useState } from 'react'
import {
  Camera,
  CameraOff,
  Copy,
  Check,
  Mic,
  MicOff,
  MessageSquare,
  PhoneOff,
  Radio,
  ShieldOff,
  Volume2,
} from 'lucide-react'
import { Badge, Button, Metric, Select } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { GuestRuntime } from './useDirectorBridge'
import type { ParticipantSummary } from './types'
import type { EngineCapabilities, QualityProfile } from '@/lib/media/engine'
import type { Capability } from '@/lib/rbac'

const STATE_LABEL: Record<ParticipantSummary['state'], string> = {
  INVITED: 'Invité',
  READY: 'En préparation',
  CONNECTING: 'Connexion…',
  LIVE: 'Connecté',
  DISCONNECTED: 'Déconnecté',
  REVOKED: 'Révoqué',
}

const STATE_TONE: Record<ParticipantSummary['state'], 'neutral' | 'ok' | 'warn' | 'crit'> = {
  INVITED: 'neutral',
  READY: 'warn',
  CONNECTING: 'warn',
  LIVE: 'ok',
  DISCONNECTED: 'crit',
  REVOKED: 'crit',
}

export interface CardActions {
  setOnAir: (onAir: boolean) => void
  setMic: (enabled: boolean) => void
  setCamera: (enabled: boolean) => void
  setVolume: (value: number) => void
  setQuality: (profile: ParticipantSummary['qualityProfile']) => void
  setReturnBus: (bus: string | null) => void
  openTalkback: (open: boolean) => void
  sendMessage: (text: string) => void
  hangup: () => void
  revoke: () => void
}

export function CorrespondentCard({
  participant,
  runtime,
  capabilities,
  userCapabilities,
  qualityProfiles,
  returnBuses,
  talkbackOn,
  actions,
  pending,
}: {
  participant: ParticipantSummary
  runtime: GuestRuntime | undefined
  capabilities: EngineCapabilities
  userCapabilities: Capability[]
  qualityProfiles: QualityProfile[]
  returnBuses: string[]
  talkbackOn: boolean
  actions: CardActions
  pending: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [volume, setVolume] = useState(100)

  const may = (capability: Capability) => userCapabilities.includes(capability)
  const metrics = runtime?.metrics
  const connected = runtime?.connected ?? false
  const live = participant.state === 'LIVE' || connected

  const loss = metrics?.packetLossPct ?? null
  const lossTone = loss === null ? 'neutral' : loss > 3 ? 'crit' : loss > 1 ? 'warn' : 'ok'
  const rtt = metrics?.rttMs ?? null
  const rttTone = rtt === null ? 'neutral' : rtt > 300 ? 'crit' : rtt > 150 ? 'warn' : 'ok'

  async function copyVmixLink() {
    try {
      await navigator.clipboard.writeText(participant.vmixUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      // Le presse-papiers peut être refusé : on sélectionne alors le texte.
      window.prompt('Copiez ce lien pour vMix :', participant.vmixUrl)
    }
  }

  return (
    <article
      className={cn(
        'panel flex flex-col gap-2 p-2.5',
        participant.onAir && 'border-onair/70 shadow-onair',
        participant.state === 'REVOKED' && 'opacity-50',
      )}
    >
      {/* Identité + état */}
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-txt">{participant.displayName}</p>
          <p className="truncate font-mono text-2xs text-txt2">{participant.streamId}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {participant.onAir ? (
            <Badge tone="onair" pulse>
              <Radio size={9} /> On air
              {participant.onAirSource === 'VMIX' ? ' · vMix' : ''}
            </Badge>
          ) : (
            <Badge tone="neutral">Standby</Badge>
          )}
          <Badge tone={STATE_TONE[participant.state]}>{STATE_LABEL[participant.state]}</Badge>
        </div>
      </header>

      {/* Niveau audio mesuré */}
      <LoudnessBar level={runtime?.loudness ?? null} muted={!participant.micAllowed} />

      {/* Mesures réelles. « — » signifie non mesuré, jamais 0. */}
      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 border-y border-line/50 py-1.5">
        <Metric label="Résolution" value={metrics?.resolution ?? null} />
        <Metric label="Images/s" value={metrics?.framerate ?? null} />
        <Metric label="Vidéo" value={metrics?.videoKbps ?? null} unit=" kb/s" />
        <Metric label="Audio" value={metrics?.audioKbps ?? null} unit=" kb/s" />
        <Metric label="Pertes" value={loss} unit=" %" tone={lossTone} />
        <Metric label="RTT" value={rtt} unit=" ms" tone={rttTone} />
      </div>

      {/* Commandes — seules celles réellement disponibles sont rendues */}
      <div className="flex flex-wrap gap-1.5">
        {may('participant.onair') && (
          <Button
            size="sm"
            variant={participant.onAir ? 'onair' : 'secondary'}
            disabled={pending || !live}
            onClick={() => actions.setOnAir(!participant.onAir)}
            title={
              live
                ? participant.onAir
                  ? 'Repasser en standby'
                  : 'Passer à l’antenne'
                : 'Le correspondant n’est pas connecté'
            }
          >
            <Radio size={12} />
            {participant.onAir ? 'On air' : 'Standby'}
          </Button>
        )}

        {capabilities.remoteMicControl && may('control.mic') && (
          <Button
            size="sm"
            variant={participant.micAllowed ? 'secondary' : 'danger'}
            disabled={pending}
            onClick={() => actions.setMic(!participant.micAllowed)}
            title={
              participant.micAllowed
                ? 'Couper le micro publié par le correspondant'
                : 'Réautoriser son micro'
            }
          >
            {participant.micAllowed ? <Mic size={12} /> : <MicOff size={12} />}
            Micro
          </Button>
        )}

        {capabilities.remoteCameraControl && may('control.camera') && (
          <Button
            size="sm"
            variant={participant.cameraAllowed ? 'secondary' : 'danger'}
            disabled={pending}
            onClick={() => actions.setCamera(!participant.cameraAllowed)}
          >
            {participant.cameraAllowed ? <Camera size={12} /> : <CameraOff size={12} />}
            Caméra
          </Button>
        )}

        {(capabilities.talkbackUnidirectional || capabilities.talkbackBidirectional) &&
          may('control.talkback') && (
            <Button
              size="sm"
              variant={talkbackOn ? 'primary' : 'secondary'}
              disabled={pending || !live}
              // Maintien enfoncé : pas d'état « talkback resté ouvert ».
              onPointerDown={() => actions.openTalkback(true)}
              onPointerUp={() => actions.openTalkback(false)}
              onPointerLeave={() => talkbackOn && actions.openTalkback(false)}
              title="Maintenir pour parler en privé (push-to-talk)"
            >
              <Volume2 size={12} /> Talkback
            </Button>
          )}

        {capabilities.directedChat && may('control.message') && (
          <Button size="sm" variant="ghost" onClick={() => setMessageOpen((v) => !v)}>
            <MessageSquare size={12} /> Message
          </Button>
        )}

        {/* `title` porte l'URL pour la relire au survol, mais `aria-label` dit
            ce que FAIT le bouton : sans lui, un lecteur d'écran annonçait
            l'URL entière en guise de nom. */}
        <Button
          size="sm"
          variant="ghost"
          onClick={copyVmixLink}
          title={participant.vmixUrl}
          aria-label={`Copier le lien vMix de ${participant.displayName}`}
        >
          {copied ? <Check size={12} className="text-ok" /> : <Copy size={12} />}
          Lien vMix
        </Button>

        {capabilities.remoteHangup && may('participant.disconnect') && (
          <Button
            size="sm"
            variant="danger"
            disabled={pending || !live}
            onClick={() => {
              if (window.confirm(`Déconnecter ${participant.displayName} ?`)) actions.hangup()
            }}
          >
            <PhoneOff size={12} /> Déconnecter
          </Button>
        )}

        {may('invitation.revoke') && participant.state !== 'REVOKED' && (
          <Button
            size="sm"
            variant="danger"
            disabled={pending}
            onClick={() => {
              if (
                window.confirm(
                  `Révoquer définitivement l’accès de ${participant.displayName} ? ` +
                    'Son lien cesse immédiatement de fonctionner.',
                )
              ) {
                actions.revoke()
              }
            }}
          >
            <ShieldOff size={12} /> Révoquer
          </Button>
        )}
      </div>

      {messageOpen && (
        <form
          className="flex gap-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (message.trim()) {
              actions.sendMessage(message.trim())
              setMessage('')
              setMessageOpen(false)
            }
          }}
        >
          <input
            autoFocus
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={280}
            placeholder="Antenne dans 10 secondes"
            className="w-full rounded-md border border-line bg-bg px-2 py-1 text-xs"
          />
          <Button size="sm" variant="primary" type="submit">
            Envoyer
          </Button>
        </form>
      )}

      {/* Réglages fins */}
      <div className="grid grid-cols-2 gap-2 border-t border-line/50 pt-2">
        <label className="space-y-0.5">
          <span className="metric-label">Profil</span>
          <Select
            className="h-7 py-0 text-xs"
            value={participant.qualityProfile}
            disabled={!may('participant.write') || pending}
            onChange={(e) =>
              actions.setQuality(e.target.value as ParticipantSummary['qualityProfile'])
            }
          >
            {qualityProfiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.label}
              </option>
            ))}
          </Select>
        </label>

        <label className="space-y-0.5">
          <span className="metric-label">Bus de retour</span>
          <Select
            className="h-7 py-0 text-xs"
            value={participant.returnBus ?? ''}
            disabled={!may('control.returnbus') || pending}
            onChange={(e) => actions.setReturnBus(e.target.value || null)}
          >
            <option value="">Retour commun</option>
            {returnBuses.map((bus) => (
              <option key={bus} value={bus}>
                Bus {bus}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {capabilities.remoteVolumeControl && may('control.mic') && (
        <label className="space-y-0.5">
          <span className="metric-label">
            Volume d&apos;écoute du correspondant · {volume} %
          </span>
          <input
            type="range"
            min={0}
            max={200}
            step={5}
            value={volume}
            onChange={(e) => setVolume(Number(e.target.value))}
            onMouseUp={() => actions.setVolume(volume)}
            onTouchEnd={() => actions.setVolume(volume)}
            className="w-full accent-[#FF9B26]"
          />
        </label>
      )}

      {participant.mapping && (
        <p className="truncate text-2xs text-txt2">
          vMix : entrée {participant.mapping.inputNumber ?? '?'} ·{' '}
          {participant.mapping.inputTitle ?? participant.mapping.inputKey}
          {participant.mapping.lastError && (
            <span className="text-crit"> · {participant.mapping.lastError}</span>
          )}
        </p>
      )}
    </article>
  )
}

/**
 * VU-mètre. Le moteur renvoie un niveau en dB ; une valeur absente affiche une
 * barre vide et non une barre à zéro animée — un VU-mètre décoratif qui bouge
 * sans signal est pire que pas de VU-mètre.
 */
function LoudnessBar({ level, muted }: { level: number | null; muted: boolean }) {
  // Les niveaux VDO.Ninja sont négatifs en dBFS ; on projette -60..0 sur 0..100.
  const pct =
    level === null ? 0 : Math.max(0, Math.min(100, ((level + 60) / 60) * 100))
  const tone = pct > 92 ? 'bg-crit' : pct > 75 ? 'bg-warn' : 'bg-ok'
  return (
    <div className="flex items-center gap-2">
      <span className="metric-label w-9 shrink-0">Niv.</span>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-bg">
        {level !== null && (
          <div
            className={cn('h-full transition-[width] duration-120', muted ? 'bg-txt2/40' : tone)}
            style={{ width: `${pct}%` }}
          />
        )}
      </div>
      <span className="tabular w-12 shrink-0 text-right text-2xs text-txt2">
        {level === null ? '—' : `${Math.round(level)} dB`}
      </span>
    </div>
  )
}
