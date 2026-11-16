'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type PermissionPhase = 'idle' | 'requesting' | 'granted' | 'denied' | 'error'

export interface DeviceOption {
  deviceId: string
  label: string
}

export interface MediaError {
  /** Nom technique de l'erreur DOM, conservé pour le diagnostic. */
  name: string
  /** Message destiné au correspondant, en français, avec la marche à suivre. */
  message: string
}

/**
 * Traduit une erreur `getUserMedia` en consigne utilisable par un journaliste.
 * Chaque cas est nommé : « ça ne marche pas » n'aide personne en direct.
 */
export function describeMediaError(error: unknown): MediaError {
  const name = error instanceof DOMException ? error.name : 'UnknownError'
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return {
        name,
        message:
          "L'accès à la caméra ou au micro a été refusé. Ouvrez les réglages du site " +
          "dans votre navigateur (icône à gauche de l'adresse), autorisez la caméra et " +
          'le microphone, puis rechargez cette page.',
      }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        name,
        message:
          "Aucun périphérique correspondant n'a été trouvé. Vérifiez que votre caméra " +
          'est branchée, puis réessayez.',
      }
    case 'NotReadableError':
    case 'AbortError':
      return {
        name,
        message:
          'La caméra ou le micro est déjà utilisé par une autre application ' +
          '(visioconférence, logiciel d’enregistrement). Fermez-la et réessayez.',
      }
    default:
      return {
        name,
        message:
          "Impossible d'accéder aux périphériques. Si vous êtes sur iPhone, utilisez " +
          'Safari ; sur Android, utilisez Chrome.',
      }
  }
}

export interface LocalMediaState {
  phase: PermissionPhase
  error: MediaError | null
  cameras: DeviceOption[]
  microphones: DeviceOption[]
  speakers: DeviceOption[]
  /** `true` seulement si le navigateur sait réellement changer de sortie audio. */
  canChooseSpeaker: boolean
  selectedCamera: string | null
  selectedMicrophone: string | null
  selectedSpeaker: string | null
  /** Niveau du micro mesuré en temps réel (0 à 1), ou `null` si non mesuré. */
  micLevel: number | null
}

/**
 * Gère les périphériques locaux de la salle de préparation.
 *
 * Deux points de méthode :
 *  - l'autorisation est demandée **sur action explicite**, jamais au chargement.
 *    C'est obligatoire sur iOS/Safari et correct partout ailleurs.
 *  - le sélecteur de sortie audio n'est exposé que si `setSinkId` existe. Sur
 *    Safari il n'existe pas : mieux vaut ne rien afficher qu'un menu inopérant.
 */
export function useLocalMedia() {
  const [state, setState] = useState<LocalMediaState>({
    phase: 'idle',
    error: null,
    cameras: [],
    microphones: [],
    speakers: [],
    canChooseSpeaker:
      typeof window !== 'undefined' &&
      typeof HTMLMediaElement !== 'undefined' &&
      'setSinkId' in HTMLMediaElement.prototype,
    selectedCamera: null,
    selectedMicrophone: null,
    selectedSpeaker: null,
    micLevel: null,
  })

  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const rafRef = useRef<number | null>(null)
  const videoRef = useRef<HTMLVideoElement | null>(null)

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    void audioContextRef.current?.close().catch(() => undefined)
    audioContextRef.current = null
  }, [])

  /** Libère caméra et micro. Indispensable avant d'entrer en salle, sinon le
   *  moteur média trouve les périphériques occupés (`NotReadableError`). */
  const release = useCallback(() => {
    stopMeter()
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setState((previous) => ({ ...previous, micLevel: null }))
  }, [stopMeter])

  const startMeter = useCallback(
    (stream: MediaStream) => {
      stopMeter()
      const track = stream.getAudioTracks()[0]
      if (!track) return
      try {
        const AudioCtx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext
        if (!AudioCtx) return
        const context = new AudioCtx()
        audioContextRef.current = context
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.6
        source.connect(analyser)
        const buffer = new Float32Array(analyser.fftSize)

        const loop = () => {
          analyser.getFloatTimeDomainData(buffer)
          // RMS : une vraie mesure d'énergie, pas une animation décorative.
          let sum = 0
          for (const sample of buffer) sum += sample * sample
          const rms = Math.sqrt(sum / buffer.length)
          setState((previous) => ({ ...previous, micLevel: Math.min(1, rms * 4) }))
          rafRef.current = requestAnimationFrame(loop)
        }
        loop()
      } catch {
        // Un VU-mètre indisponible n'empêche pas de passer à l'antenne.
        setState((previous) => ({ ...previous, micLevel: null }))
      }
    },
    [stopMeter],
  )

  const open = useCallback(
    async (cameraId?: string | null, microphoneId?: string | null) => {
      setState((previous) => ({ ...previous, phase: 'requesting', error: null }))
      release()
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: cameraId ? { deviceId: { exact: cameraId } } : true,
          audio: microphoneId
            ? { deviceId: { exact: microphoneId }, echoCancellation: true }
            : { echoCancellation: true },
        })
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          void videoRef.current.play().catch(() => undefined)
        }
        startMeter(stream)

        // Les étiquettes ne sont lisibles qu'après autorisation accordée.
        const devices = await navigator.mediaDevices.enumerateDevices()
        const byKind = (kind: MediaDeviceKind): DeviceOption[] =>
          devices
            .filter((device) => device.kind === kind && device.deviceId)
            .map((device, index) => ({
              deviceId: device.deviceId,
              label: device.label || `${labelFor(kind)} ${index + 1}`,
            }))

        const activeVideo = stream.getVideoTracks()[0]?.getSettings().deviceId ?? null
        const activeAudio = stream.getAudioTracks()[0]?.getSettings().deviceId ?? null

        setState((previous) => ({
          ...previous,
          phase: 'granted',
          error: null,
          cameras: byKind('videoinput'),
          microphones: byKind('audioinput'),
          speakers: byKind('audiooutput'),
          selectedCamera: cameraId ?? activeVideo,
          selectedMicrophone: microphoneId ?? activeAudio,
          selectedSpeaker: previous.selectedSpeaker,
        }))
      } catch (error) {
        const described = describeMediaError(error)
        setState((previous) => ({
          ...previous,
          phase: described.name === 'NotAllowedError' ? 'denied' : 'error',
          error: described,
        }))
      }
    },
    [release, startMeter],
  )

  const selectSpeaker = useCallback((deviceId: string) => {
    setState((previous) => ({ ...previous, selectedSpeaker: deviceId }))
  }, [])

  useEffect(() => () => release(), [release])

  // On ne renvoie PAS `streamRef` : aucun appelant n'en a besoin, et exposer une
  // référence dans l'objet de retour conduirait React à traiter toutes ses
  // propriétés comme des valeurs de référence, interdites pendant le rendu.
  return { state, videoRef, open, release, selectSpeaker }
}

function labelFor(kind: MediaDeviceKind): string {
  if (kind === 'videoinput') return 'Caméra'
  if (kind === 'audioinput') return 'Microphone'
  return 'Sortie audio'
}

// ── Test de connexion ─────────────────────────────────────────────────────────

export interface ConnectivityResult {
  /** Candidats locaux (toujours présents si WebRTC fonctionne). */
  host: boolean
  /** Candidat réflexif : votre adresse publique a été découverte via STUN. */
  srflx: boolean
  /** Candidat relayé : nécessite un serveur TURN. */
  relay: boolean
  /** Durée de la collecte. */
  durationMs: number
  /** `true` si aucun serveur STUN n'était configuré — le test est alors partiel. */
  partial: boolean
  verdict: 'ok' | 'risky' | 'blocked' | 'unsupported'
  summary: string
}

/**
 * Collecte de candidats ICE. C'est une mesure réelle, pas une barre de
 * progression : on crée une `RTCPeerConnection`, on ouvre un canal de données et
 * on observe les candidats que le navigateur produit.
 */
export async function testConnectivity(
  stunUrls: string[],
  timeoutMs = 5000,
): Promise<ConnectivityResult> {
  const started = Date.now()
  const partial = stunUrls.length === 0

  if (typeof RTCPeerConnection === 'undefined') {
    return {
      host: false,
      srflx: false,
      relay: false,
      durationMs: 0,
      partial,
      verdict: 'unsupported',
      summary: "Ce navigateur ne prend pas en charge WebRTC. Utilisez Chrome, Edge, Firefox ou Safari.",
    }
  }

  const found = { host: false, srflx: false, relay: false }
  const connection = new RTCPeerConnection({
    iceServers: stunUrls.length > 0 ? [{ urls: stunUrls }] : [],
  })

  try {
    connection.createDataChannel('probe')
    await new Promise<void>((resolve) => {
      const done = () => resolve()
      const timer = setTimeout(done, timeoutMs)
      connection.onicecandidate = (event) => {
        if (!event.candidate) {
          clearTimeout(timer)
          done()
          return
        }
        const type = event.candidate.type
        if (type === 'host') found.host = true
        else if (type === 'srflx' || type === 'prflx') found.srflx = true
        else if (type === 'relay') found.relay = true
      }
      void connection
        .createOffer()
        .then((offer) => connection.setLocalDescription(offer))
        .catch(() => {
          clearTimeout(timer)
          done()
        })
    })
  } finally {
    connection.close()
  }

  const durationMs = Date.now() - started

  if (!found.host && !found.srflx && !found.relay) {
    return {
      ...found,
      durationMs,
      partial,
      verdict: 'blocked',
      summary:
        "Aucune route réseau n'a été trouvée. Votre réseau bloque probablement WebRTC. " +
        'Essayez un partage de connexion mobile.',
    }
  }
  if (partial) {
    return {
      ...found,
      durationMs,
      partial,
      verdict: 'risky',
      summary:
        'Test partiel : aucun serveur STUN n’est configuré sur cette installation. ' +
        'Les routes locales fonctionnent, mais la traversée de votre routeur n’a pas pu ' +
        'être vérifiée.',
    }
  }
  if (!found.srflx) {
    return {
      ...found,
      durationMs,
      partial,
      verdict: 'risky',
      summary:
        'Votre adresse publique n’a pas été découverte. La connexion risque d’échouer ' +
        'derrière ce réseau — prévenez la régie et prévoyez un partage de connexion mobile.',
    }
  }
  return {
    ...found,
    durationMs,
    partial,
    verdict: 'ok',
    summary: `Route réseau validée en ${durationMs} ms.`,
  }
}
