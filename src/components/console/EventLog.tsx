'use client'

import { Button, Panel } from '@/components/ui'
import { cn } from '@/lib/cn'
import type { EventRow, ParticipantSummary } from './types'

const TYPE_LABEL: Record<string, string> = {
  JOIN_REQUESTED: 'Entrée en salle',
  CONNECTED: 'Connecté',
  DISCONNECTED: 'Déconnecté',
  RECONNECTED: 'Reconnecté',
  MIC_CHANGED: 'Micro',
  CAMERA_CHANGED: 'Caméra',
  ON_AIR_CHANGED: 'Antenne',
  QUALITY_CHANGED: 'Qualité',
  TALKBACK_OPENED: 'Talkback ouvert',
  TALKBACK_CLOSED: 'Talkback fermé',
  MESSAGE_SENT: 'Message',
  METRICS_ALERT: 'Alerte réseau',
  ERROR: 'Erreur',
}

const TYPE_TONE: Record<string, string> = {
  DISCONNECTED: 'text-crit',
  ERROR: 'text-crit',
  METRICS_ALERT: 'text-warn',
  TALKBACK_OPENED: 'text-accent',
  ON_AIR_CHANGED: 'text-onair',
  CONNECTED: 'text-ok',
  RECONNECTED: 'text-ok',
}

export function EventLog({
  events,
  participants,
  onClear,
}: {
  events: EventRow[]
  participants: ParticipantSummary[]
  onClear: () => void
}) {
  const nameOf = (participantId: string | null) =>
    participantId
      ? (participants.find((p) => p.id === participantId)?.displayName ?? '—')
      : 'Session'

  return (
    <Panel
      title="Journal d'événements"
      className="min-h-[180px]"
      actions={
        events.length > 0 && (
          <Button size="sm" variant="ghost" onClick={onClear}>
            Effacer l&apos;affichage
          </Button>
        )
      }
    >
      {events.length === 0 ? (
        <p className="text-xs text-txt2">Aucun événement enregistré pour cette session.</p>
      ) : (
        <ol className="space-y-1">
          {events.map((event) => (
            <li key={event.id} className="flex gap-2 text-2xs leading-relaxed">
              <time className="tabular shrink-0 text-txt2" dateTime={event.at}>
                {new Date(event.at).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </time>
              <span className={cn('w-28 shrink-0 font-semibold', TYPE_TONE[event.type] ?? 'text-txt2')}>
                {TYPE_LABEL[event.type] ?? event.type}
              </span>
              <span className="min-w-0 flex-1 truncate text-txt">
                {nameOf(event.participantId)}
                {event.message ? ` · ${event.message}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
      <p className="mt-2 border-t border-line/50 pt-2 text-2xs text-txt2">
        L&apos;affichage montre les derniers événements enregistrés en base. « Effacer »
        ne supprime rien : le journal reste intégralement conservé côté serveur.
      </p>
    </Panel>
  )
}
