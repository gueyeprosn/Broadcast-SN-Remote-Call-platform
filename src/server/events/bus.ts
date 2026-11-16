import { log } from '@/lib/logger'

/**
 * Bus d'événements applicatifs.
 *
 * Portée : ON AIR, messages du réalisateur, révocation, mapping vMix, états
 * d'invitation. **Pas** les événements média (stats WebRTC, connexions) qui
 * passent par `postMessage` entre notre page et l'iframe du moteur.
 *
 * Implémentation : en mémoire, diffusé aux clients par Server-Sent Events.
 * LIMITE CONNUE : mono-instance. Pour plusieurs répliques, remplacer
 * `publish`/`subscribe` par Redis pub/sub — aucun autre fichier ne change.
 */

export type AppEvent =
  | { type: 'participant.state'; participantId: string; state: string }
  | { type: 'participant.onair'; participantId: string; onAir: boolean; source: 'MANUAL' | 'VMIX' }
  | { type: 'participant.permissions'; participantId: string; micAllowed: boolean; cameraAllowed: boolean }
  | { type: 'participant.quality'; participantId: string; profile: string }
  | { type: 'participant.returnbus'; participantId: string; bus: string | null }
  | { type: 'participant.revoked'; participantId: string; reason: string }
  | { type: 'participant.metrics'; participantId: string; metrics: unknown }
  | { type: 'director.message'; participantId: string | null; text: string; at: string }
  | { type: 'talkback.state'; participantId: string | null; open: boolean }
  | { type: 'session.state'; sessionId: string; state: string }
  | { type: 'vmix.mapping'; participantId: string; inputTitle: string | null }
  | { type: 'heartbeat'; at: string }

export interface Envelope {
  id: number
  topic: string
  event: AppEvent
  at: string
}

type Listener = (envelope: Envelope) => void

const listeners = new Map<string, Set<Listener>>()
/** Petit tampon par sujet pour permettre une reprise après coupure (Last-Event-ID). */
const buffers = new Map<string, Envelope[]>()
const BUFFER_SIZE = 100
let sequence = 0

/** Sujet d'une session : `session:<id>`. */
export const sessionTopic = (sessionId: string) => `session:${sessionId}`

export function publish(topic: string, event: AppEvent): Envelope {
  sequence += 1
  const envelope: Envelope = { id: sequence, topic, event, at: new Date().toISOString() }

  const buffer = buffers.get(topic) ?? []
  buffer.push(envelope)
  if (buffer.length > BUFFER_SIZE) buffer.splice(0, buffer.length - BUFFER_SIZE)
  buffers.set(topic, buffer)

  const set = listeners.get(topic)
  if (set) {
    for (const listener of set) {
      try {
        listener(envelope)
      } catch (error) {
        log.warn('bus.listener_failed', {
          topic,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
  return envelope
}

export function subscribe(topic: string, listener: Listener): () => void {
  const set = listeners.get(topic) ?? new Set<Listener>()
  set.add(listener)
  listeners.set(topic, set)
  return () => {
    set.delete(listener)
    if (set.size === 0) listeners.delete(topic)
  }
}

/** Événements du tampon postérieurs à `lastId`, pour une reconnexion SSE. */
export function replay(topic: string, lastId: number): Envelope[] {
  return (buffers.get(topic) ?? []).filter((e) => e.id > lastId)
}

export function listenerCount(topic: string): number {
  return listeners.get(topic)?.size ?? 0
}
