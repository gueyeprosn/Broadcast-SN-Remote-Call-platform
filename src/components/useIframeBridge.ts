'use client'

import { useCallback, useEffect, useRef, type RefObject } from 'react'
import { IframeBridge, type EngineMessage } from '@/lib/media/iframe-bridge'

/**
 * Monte un pont `postMessage` vers une iframe de moteur média.
 *
 * Le pont est construit **dans un effet**, pas pendant le rendu : lire
 * `ref.current` au rendu donnerait une valeur périmée et React le signale à
 * juste titre. Le gestionnaire de message est gardé dans une référence mise à
 * jour par un effet, de sorte que le pont reste stable même si le composant
 * se rerend à chaque statistique reçue (c'est-à-dire toutes les deux secondes).
 */
export function useIframeBridge(
  frameRef: RefObject<HTMLIFrameElement | null>,
  engineOrigin: string,
  onMessage: (message: EngineMessage) => void,
) {
  const bridgeRef = useRef<IframeBridge | null>(null)
  const handlerRef = useRef(onMessage)

  useEffect(() => {
    handlerRef.current = onMessage
  }, [onMessage])

  useEffect(() => {
    const bridge = new IframeBridge(frameRef, engineOrigin)
    bridgeRef.current = bridge
    bridge.start()
    const off = bridge.on((message) => handlerRef.current(message))
    return () => {
      off()
      bridge.stop()
      bridgeRef.current = null
    }
  }, [frameRef, engineOrigin])

  /** Envoie un message au moteur. `false` si l'iframe n'est pas encore prête. */
  const send = useCallback((message: Record<string, unknown>): boolean => {
    return bridgeRef.current?.send(message) ?? false
  }, [])

  return send
}
