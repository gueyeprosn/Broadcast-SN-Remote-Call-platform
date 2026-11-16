'use client'

/**
 * Pont `postMessage` entre notre page et l'iframe du moteur média.
 *
 * Pourquoi ce fichier existe plutôt qu'un `postMessage` direct :
 *
 * Le code de référence de VDO.Ninja envoie ses messages avec
 * `targetOrigin = '*'` et ne valide, en réception, que `event.source` — pas
 * `event.origin` (voir docs/01-AUDIT.md §2.4). Nous ne pouvons pas corriger cela
 * chez eux, et nous ne devons pas modifier leur code. Nous compensons donc ici :
 *
 *  - en émission : jamais `'*'`, toujours l'origine exacte du moteur ;
 *  - en réception : `event.origin` ET `event.source` sont vérifiés ;
 *  - aucun message entrant ne décide d'une autorisation — les droits sont
 *    réévalués côté serveur.
 */

export interface InboundStat {
  streamID?: string
  resolution?: string
  video_bitrate_kbps?: number
  audio_bitrate_kbps?: number
  framerate?: number
  packetLoss?: number
  nackCount?: number
  jitter?: number
  currentRoundTripTime?: number
  [key: string]: unknown
}

export type EngineMessage =
  | { kind: 'stats'; inbound: Record<string, InboundStat>; totals: { inbound: number; outbound: number } }
  | { kind: 'guest-connected'; streamId: string; label: string | null }
  | { kind: 'guest-disconnected'; streamId: string }
  | { kind: 'director-connected' }
  | { kind: 'loudness'; levels: Record<string, number>; mode: string | null }
  | { kind: 'stream-ids'; labels: Record<string, string> }
  | { kind: 'device-list'; devices: Array<{ kind: string; label: string }> }
  | { kind: 'chat'; text: string }
  | { kind: 'raw'; data: Record<string, unknown> }

type Handler = (message: EngineMessage) => void

export interface FrameHolder {
  current: HTMLIFrameElement | null
}

export class IframeBridge {
  private readonly handlers = new Set<Handler>()
  private listener: ((event: MessageEvent) => void) | null = null
  private readonly holder: FrameHolder
  private readonly engineOrigin: string

  /**
   * `holder` est la référence React de l'iframe. Le pont la lit au moment
   * d'émettre ou de recevoir, jamais pendant le rendu : c'est pourquoi on reçoit
   * l'objet de référence et non une fermeture qui l'aurait déjà déréférencé.
   */
  constructor(holder: FrameHolder, engineOrigin: string) {
    this.holder = holder
    this.engineOrigin = engineOrigin
  }

  private frame(): HTMLIFrameElement | null {
    return this.holder.current
  }

  start(): void {
    if (this.listener) return
    this.listener = (event: MessageEvent) => {
      // 1. L'origine doit être exactement celle du moteur.
      if (event.origin !== this.engineOrigin) return
      // 2. Le message doit provenir de NOTRE iframe, pas d'un autre cadre.
      const win = this.frame()?.contentWindow

      if (!win || event.source !== win) return
      // 3. Le contenu doit être un objet.
      if (typeof event.data !== 'object' || event.data === null) return
      const decoded = decode(event.data as Record<string, unknown>)
      if (decoded) for (const handler of this.handlers) handler(decoded)
    }
    window.addEventListener('message', this.listener)
  }

  stop(): void {
    if (this.listener) window.removeEventListener('message', this.listener)
    this.listener = null
    this.handlers.clear()
  }

  on(handler: Handler): () => void {
    this.handlers.add(handler)
    return () => this.handlers.delete(handler)
  }

  /** Envoie un message au moteur. Retourne `false` si l'iframe n'est pas prête. */
  send(message: Record<string, unknown>): boolean {
    const win = this.frame()?.contentWindow
    if (!win) return false
    // Origine explicite : jamais '*'.
    win.postMessage(message, this.engineOrigin)
    return true
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asNumberMap(value: unknown): Record<string, number> {
  const record = asRecord(value)
  if (!record) return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(record)) {
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = v
  }
  return out
}

function decode(data: Record<string, unknown>): EngineMessage | null {
  // `loudness` est testé avant `action` : le moteur peut envoyer les deux
  // ensemble (`action: "loudness"`), et c'est la charge utile qui nous intéresse.
  if ('loudness' in data) {
    return {
      kind: 'loudness',
      levels: asNumberMap(data['loudness']),
      mode: typeof data['mode'] === 'string' ? data['mode'] : null,
    }
  }

  if ('stats' in data) {
    const stats = asRecord(data['stats'])
    const inboundRaw = asRecord(stats?.['inbound'] ?? stats?.['inbound_stats']) ?? {}
    const inbound: Record<string, InboundStat> = {}
    for (const [streamId, value] of Object.entries(inboundRaw)) {
      const record = asRecord(value)
      if (record) inbound[streamId] = record as InboundStat
    }
    return {
      kind: 'stats',
      inbound,
      totals: {
        inbound: numberOr(stats?.['total_inbound_connections'], 0),
        outbound: numberOr(stats?.['total_outbound_connections'], 0),
      },
    }
  }

  if ('streamIDs' in data) {
    const record = asRecord(data['streamIDs']) ?? {}
    const labels: Record<string, string> = {}
    for (const [k, v] of Object.entries(record)) labels[k] = String(v)
    return { kind: 'stream-ids', labels }
  }

  if ('deviceList' in data && Array.isArray(data['deviceList'])) {
    const devices = (data['deviceList'] as unknown[])
      .map(asRecord)
      .filter((d): d is Record<string, unknown> => d !== null)
      .map((d) => ({ kind: String(d['kind'] ?? ''), label: String(d['label'] ?? '') }))
    return { kind: 'device-list', devices }
  }

  if ('gotChat' in data) {
    const chat = asRecord(data['gotChat'])
    const text = typeof chat?.['msg'] === 'string' ? chat['msg'] : null
    if (text) return { kind: 'chat', text }
  }

  if (typeof data['action'] === 'string') {
    const streamId = typeof data['streamID'] === 'string' ? data['streamID'] : ''
    switch (data['action']) {
      case 'guest-connected': {
        const value = asRecord(data['value'])
        const label = typeof value?.['label'] === 'string' ? value['label'] : null
        return { kind: 'guest-connected', streamId, label }
      }
      case 'guest-disconnected':
        return { kind: 'guest-disconnected', streamId }
      case 'director-connected':
        return { kind: 'director-connected' }
      case 'view-stats-updated':
        return null // bruit : ignoré
      default:
        return { kind: 'raw', data }
    }
  }

  return { kind: 'raw', data }
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Extrait des mesures comparables d'une entrée `stats.inbound`.
 *
 * Les clés exactes de VDO.Ninja varient selon la version et le navigateur. On
 * tente plusieurs noms connus et on renvoie `null` quand la donnée n'est pas là,
 * jamais `0` : un `0` affiché serait un mensonge (« 0 fps » ≠ « non mesuré »).
 */
export interface NormalizedMetrics {
  resolution: string | null
  framerate: number | null
  videoKbps: number | null
  audioKbps: number | null
  packetLossPct: number | null
  rttMs: number | null
  jitterMs: number | null
}

export function normalizeMetrics(stat: InboundStat | undefined): NormalizedMetrics {
  if (!stat) {
    return {
      resolution: null,
      framerate: null,
      videoKbps: null,
      audioKbps: null,
      packetLossPct: null,
      rttMs: null,
      jitterMs: null,
    }
  }
  const pick = (...keys: string[]): number | null => {
    for (const key of keys) {
      const value = stat[key]
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string') {
        const parsed = Number.parseFloat(value)
        if (Number.isFinite(parsed)) return parsed
      }
    }
    return null
  }
  const pickString = (...keys: string[]): string | null => {
    for (const key of keys) {
      const value = stat[key]
      if (typeof value === 'string' && value.trim() !== '') return value
    }
    return null
  }

  const width = pick('frameWidth', 'width', 'video_width')
  const height = pick('frameHeight', 'height', 'video_height')
  const resolution =
    pickString('resolution', 'video_resolution') ??
    (width !== null && height !== null ? `${Math.round(width)}x${Math.round(height)}` : null)

  const rttSeconds = pick('currentRoundTripTime', 'roundTripTime')
  const jitterSeconds = pick('jitter')

  return {
    resolution,
    framerate: pick('framesPerSecond', 'framerate', 'fps', 'video_fps'),
    videoKbps: pick('video_bitrate_kbps', 'bitrate_video_kbps', 'videoBitrate'),
    audioKbps: pick('audio_bitrate_kbps', 'bitrate_audio_kbps', 'audioBitrate'),
    packetLossPct: pick('packetLoss', 'packet_loss', 'packetsLostPct'),
    // Les valeurs WebRTC sont en secondes ; on convertit si elles sont < 10.
    rttMs: rttSeconds === null ? null : rttSeconds < 10 ? rttSeconds * 1000 : rttSeconds,
    jitterMs: jitterSeconds === null ? null : jitterSeconds < 10 ? jitterSeconds * 1000 : jitterSeconds,
  }
}
