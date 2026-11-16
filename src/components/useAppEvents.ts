'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { AppEvent, Envelope } from '@/server/events/bus'

export type ConnectionState = 'connecting' | 'open' | 'retrying' | 'closed'

/**
 * Abonnement au flux d'événements applicatifs de la session.
 *
 * `EventSource` se reconnecte seul et renvoie `Last-Event-ID`, ce qui permet au
 * serveur de rejouer ce qui a été manqué (voir le tampon dans `events/bus.ts`).
 * On expose l'état réel de la connexion : la console doit pouvoir afficher
 * « supervision hors ligne » plutôt que de laisser croire que tout va bien.
 */
export function useAppEvents(
  sessionId: string,
  onEvent: (event: AppEvent, envelope: Envelope) => void,
): ConnectionState {
  const [state, setState] = useState<ConnectionState>('connecting')
  const handlerRef = useRef(onEvent)

  // La référence est mise à jour dans un effet, jamais pendant le rendu :
  // écrire dans une référence au rendu est un effet de bord invisible pour React.
  useEffect(() => {
    handlerRef.current = onEvent
  }, [onEvent])

  useEffect(() => {
    const source = new EventSource(`/api/sessions/${sessionId}/stream`)

    const dispatch = (raw: string) => {
      try {
        const envelope = JSON.parse(raw) as Envelope
        handlerRef.current(envelope.event, envelope)
      } catch {
        // Message illisible : ignoré plutôt que de rompre le flux.
      }
    }

    source.onopen = () => setState('open')
    source.onmessage = (message) => dispatch(message.data as string)
    source.addEventListener('app', (message) =>
      dispatch((message as MessageEvent).data as string),
    )
    source.onerror = () => {
      // EventSource relance lui-même ; on ne fait que refléter l'état.
      setState(source.readyState === EventSource.CLOSED ? 'closed' : 'retrying')
    }

    return () => {
      source.close()
    }
  }, [sessionId])

  return state
}

/**
 * État réseau du navigateur, lu comme un magasin externe.
 *
 * `useSyncExternalStore` est la façon correcte de refléter une valeur qui vit
 * hors de React : pas de `setState` au montage, donc pas de rendu en cascade, et
 * la valeur est juste dès le premier rendu client.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerSnapshot)
}

function subscribeOnline(callback: () => void): () => void {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

const getOnlineSnapshot = () => navigator.onLine
// Côté serveur, on suppose la connexion présente : afficher « hors ligne »
// pendant l'hydratation serait un faux signal d'alarme.
const getServerSnapshot = () => true
