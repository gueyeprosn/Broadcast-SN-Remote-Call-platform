'use client'

import { useCallback, useEffect, useReducer, useRef } from 'react'
import {
  normalizeMetrics,
  type EngineMessage,
  type NormalizedMetrics,
} from '@/lib/media/iframe-bridge'
import { useIframeBridge } from '@/components/useIframeBridge'

export interface GuestRuntime {
  /** Connexion média constatée par le canal director. */
  connected: boolean
  metrics: NormalizedMetrics
  /** Niveau audio en dB tel que renvoyé par le moteur, ou `null`. */
  loudness: number | null
  lastEventAt: number | null
}

export interface DirectorBridgeState {
  /** `true` dès que le moteur a confirmé la connexion du canal director. */
  directorReady: boolean
  /** Dernière réception de statistiques. Sert à détecter un canal muet. */
  lastStatsAt: number | null
  runtime: Record<string, GuestRuntime>
  totals: { inbound: number; outbound: number }
}

const EMPTY_METRICS: NormalizedMetrics = {
  resolution: null,
  framerate: null,
  videoKbps: null,
  audioKbps: null,
  packetLossPct: null,
  rttMs: null,
  jitterMs: null,
}

const INITIAL: DirectorBridgeState = {
  directorReady: false,
  lastStatsAt: null,
  runtime: {},
  totals: { inbound: 0, outbound: 0 },
}

/**
 * Pilotage du canal director.
 *
 * Toute la supervision passe par cette unique iframe : elle est déjà connectée à
 * tous les invités, donc l'exploiter ne coûte **aucun flux supplémentaire** aux
 * correspondants. Ouvrir une iframe de visualisation par correspondant
 * doublerait au contraire leur débit montant — inacceptable pour un journaliste
 * en 4G. Voir docs/02-ARCHITECTURE.md §4.
 */
export function useDirectorBridge(engineOrigin: string, statsIntervalMs = 2000) {
  const frameRef = useRef<HTMLIFrameElement | null>(null)
  const [state, dispatch] = useReducer(reduce, INITIAL)

  const send = useIframeBridge(
    frameRef,
    engineOrigin,
    useCallback((message: EngineMessage) => dispatch(message), []),
  )

  // Interrogation périodique : le moteur n'émet pas de statistiques spontanément.
  useEffect(() => {
    const tick = () => {
      send({ getStats: true })
      send({ getLoudness: true })
    }
    const timer = setInterval(tick, statsIntervalMs)
    const warmup = setTimeout(tick, 1500)
    return () => {
      clearInterval(timer)
      clearTimeout(warmup)
    }
  }, [send, statsIntervalMs])

  return { frameRef, state, send }
}

function reduce(state: DirectorBridgeState, message: EngineMessage): DirectorBridgeState {
  const now = Date.now()
  switch (message.kind) {
    case 'director-connected':
      return state.directorReady ? state : { ...state, directorReady: true }

    case 'guest-connected': {
      if (!message.streamId) return state
      const existing = state.runtime[message.streamId]
      return {
        ...state,
        runtime: {
          ...state.runtime,
          [message.streamId]: {
            connected: true,
            metrics: existing?.metrics ?? EMPTY_METRICS,
            loudness: existing?.loudness ?? null,
            lastEventAt: now,
          },
        },
      }
    }

    case 'guest-disconnected': {
      if (!message.streamId) return state
      const existing = state.runtime[message.streamId]
      return {
        ...state,
        runtime: {
          ...state.runtime,
          [message.streamId]: {
            // On conserve les dernières mesures mais `connected: false` les fait
            // griser : elles sont historiques, pas courantes.
            connected: false,
            metrics: existing?.metrics ?? EMPTY_METRICS,
            loudness: null,
            lastEventAt: now,
          },
        },
      }
    }

    case 'stats': {
      const runtime = { ...state.runtime }
      for (const [streamId, stat] of Object.entries(message.inbound)) {
        const existing = runtime[streamId]
        runtime[streamId] = {
          connected: true,
          metrics: normalizeMetrics(stat),
          loudness: existing?.loudness ?? null,
          lastEventAt: now,
        }
      }
      return { ...state, runtime, totals: message.totals, lastStatsAt: now }
    }

    case 'loudness': {
      const runtime = { ...state.runtime }
      for (const [streamId, level] of Object.entries(message.levels)) {
        const existing = runtime[streamId]
        runtime[streamId] = {
          connected: existing?.connected ?? true,
          metrics: existing?.metrics ?? EMPTY_METRICS,
          loudness: level,
          lastEventAt: now,
        }
      }
      return { ...state, runtime }
    }

    default:
      return state
  }
}

// La mise en forme du multiview ne passe plus par une injection de CSS. Elle
// est obtenue par les paramètres d'URL documentés du moteur — `&previewmode`,
// `&cleandirector`, `&hidesolo`, `&hidecodirectors`, `&nocontrols` — dont
// l'effet a été constaté sur la page réelle : `#directorlayout` masqué,
// `#gridlayout` visible, aucun bouton affiché.
//
// La version précédente visait `#main` et `#mainmenu`. `#main` est le `body`
// de la page du moteur, `#mainmenu` n'existe pas : la feuille ne masquait rien
// et l'interface anglaise du moteur s'affichait par-dessus la nôtre. Styler le
// balisage interne d'une application tierce était de toute façon une
// dépendance que rien ne garantissait d'une version à l'autre.
