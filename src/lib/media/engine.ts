/**
 * Contrat du moteur média.
 *
 * Ce fichier ne nomme aucun moteur. Il décrit uniquement ce dont l'application a
 * besoin. Conséquences :
 *
 *  1. Juridique — notre code reste une œuvre séparée du moteur (VDO.Ninja est
 *     sous AGPL-3.0 ; voir docs/01-AUDIT.md §1). Nous n'importons rien de lui.
 *  2. Technique — brancher un SFU maison plus tard ne demande qu'une seconde
 *     implémentation de cette interface.
 *  3. Honnêteté d'interface — `capabilities` est lu par l'UI : un bouton dont la
 *     capacité est absente n'est pas affiché, plutôt qu'affiché et inopérant.
 */

export type QualityProfileId = 'ECONOMY' | 'STANDARD' | 'BROADCAST' | 'HIGH'

export interface QualityProfile {
  id: QualityProfileId
  label: string
  /** Hauteur cible en pixels. Cible, pas garantie : la mesure réelle prime. */
  targetHeight: 360 | 480 | 720 | 1080
  targetWidth: 640 | 854 | 1280 | 1920
  /** Débit vidéo cible en kbps. */
  videoBitrateKbps: number
  /** Débit audio en kbps. */
  audioBitrateKbps: number
  note: string
}

export const QUALITY_PROFILES: Record<QualityProfileId, QualityProfile> = {
  ECONOMY: {
    id: 'ECONOMY',
    label: 'Économie · 360p',
    targetHeight: 360,
    targetWidth: 640,
    videoBitrateKbps: 500,
    audioBitrateKbps: 48,
    note: 'Réseau mobile faible. Priorité absolue à la continuité audio.',
  },
  STANDARD: {
    id: 'STANDARD',
    label: 'Standard · 480p',
    targetHeight: 480,
    targetWidth: 854,
    videoBitrateKbps: 1200,
    audioBitrateKbps: 64,
    note: '4G correcte, Wi-Fi partagé.',
  },
  BROADCAST: {
    id: 'BROADCAST',
    label: 'Broadcast · 720p',
    targetHeight: 720,
    targetWidth: 1280,
    videoBitrateKbps: 2500,
    audioBitrateKbps: 128,
    note: 'Profil de référence pour une diffusion. Connexion fixe conseillée.',
  },
  HIGH: {
    id: 'HIGH',
    label: 'Haute qualité · 1080p',
    targetHeight: 1080,
    targetWidth: 1920,
    videoBitrateKbps: 4500,
    audioBitrateKbps: 128,
    note: 'Exige une caméra 1080p et une liaison fixe stable. À vérifier avant l’antenne.',
  },
}

/**
 * Ce que le moteur sait réellement faire. Chaque drapeau doit correspondre à une
 * capacité **vérifiée** dans la documentation ou le code du moteur, jamais
 * supposée. Voir docs/01-AUDIT.md §2.
 */
export interface EngineCapabilities {
  /** Couper le micro publié par un invité depuis la régie. */
  remoteMicControl: boolean
  /** Couper la caméra d'un invité depuis la régie. */
  remoteCameraControl: boolean
  /** Régler le volume d'écoute d'un invité depuis la régie. */
  remoteVolumeControl: boolean
  /** Raccrocher un invité. */
  remoteHangup: boolean
  /** Canal privé réalisateur → invité. */
  talkbackUnidirectional: boolean
  /** Canal privé bidirectionnel. */
  talkbackBidirectional: boolean
  /** Message texte privé à un invité. */
  directedChat: boolean
  /** Statistiques WebRTC exposées au parent. */
  inboundStats: boolean
  /** Niveaux audio exposés au parent. */
  loudness: boolean
  /** Plafond de débit réglable par flux. */
  bitrateControl: boolean
  /** Demande de trame clé. */
  forceKeyframe: boolean
  /** Liste des périphériques exposée au parent. */
  deviceList: boolean
  /** Affectation d'un invité à une scène. */
  sceneAssignment: boolean
  /** Sortie « propre » sans élément d'interface. */
  cleanOutput: boolean
  /** Mix-minus pris en charge par le moteur lui-même. */
  nativeMixMinus: boolean
  /** Reconnexion automatique garantie par le moteur. */
  guaranteedReconnect: boolean
  /** Sortie NDI native. */
  ndiOutput: boolean
  /** Sortie SRT native. */
  srtOutput: boolean
}

export interface PublisherContext {
  roomName: string
  roomSecret: string
  streamId: string
  label: string
  profile: QualityProfile
  videoDeviceId?: string | undefined
  audioDeviceId?: string | undefined
  /** Autoriser le micro à l'entrée en salle. */
  micEnabled: boolean
  cameraEnabled: boolean
}

export interface DirectorContext {
  roomName: string
  roomSecret: string
}

export interface ReceiverContext {
  roomName: string
  roomSecret: string
  streamId: string
  profile: QualityProfile
}

export interface ReturnContext {
  roomName: string
  roomSecret: string
  returnStreamId: string
  /**
   * `true` si le retour est audio seul (cas le plus courant : vMix Bus A vers un
   * câble audio virtuel, sans sortie vidéo NDI).
   */
  audioOnly: boolean
  audioDeviceId?: string | undefined
  videoDeviceId?: string | undefined
}

export interface ReturnViewerContext {
  roomName: string
  roomSecret: string
  returnStreamId: string
}

/** Commande adressée à un invité depuis la régie. */
export type GuestCommand =
  | { kind: 'mic'; value: boolean | 'toggle' }
  | { kind: 'camera'; value: boolean | 'toggle' }
  | { kind: 'volume'; value: number }
  | { kind: 'hangup' }
  | { kind: 'forceKeyframe' }
  | { kind: 'talkback'; bidirectional: boolean }
  | { kind: 'chat'; text: string }
  | { kind: 'directorChat'; text: string }
  | { kind: 'bitrate'; kbps: number }

/** Commande adressée à l'iframe locale (sur soi). */
export type SelfCommand =
  | { kind: 'mic'; value: boolean | 'toggle' }
  | { kind: 'camera'; value: boolean | 'toggle' }
  | { kind: 'speakerMute'; value: boolean | 'toggle' }
  | { kind: 'volume'; value: number }
  | { kind: 'close' }
  | { kind: 'reload' }
  | { kind: 'requestStats' }
  | { kind: 'requestLoudness'; enabled: boolean }
  | { kind: 'requestDeviceList' }
  | { kind: 'requestStreamIds' }

export interface MediaEngine {
  readonly id: string
  /** Origine exacte du moteur. Sert à valider `event.origin` des messages. */
  readonly origin: string
  readonly capabilities: EngineCapabilities

  publisherUrl(ctx: PublisherContext): string
  directorUrl(ctx: DirectorContext): string
  receiverUrl(ctx: ReceiverContext): string
  returnPublisherUrl(ctx: ReturnContext): string
  returnViewerUrl(ctx: ReturnViewerContext): string

  /** Traduit une commande métier en message `postMessage`, ou `null` si le moteur ne sait pas le faire. */
  encodeGuestCommand(target: string, command: GuestCommand): Record<string, unknown> | null
  encodeSelfCommand(command: SelfCommand): Record<string, unknown> | null
}
