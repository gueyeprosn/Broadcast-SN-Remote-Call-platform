import type {
  DirectorContext,
  EngineCapabilities,
  GuestCommand,
  MediaEngine,
  PublisherContext,
  QualityProfileId,
  ReceiverContext,
  ReturnContext,
  ReturnViewerContext,
  SelfCommand,
} from './engine'

/**
 * Adaptateur VDO.Ninja.
 *
 * Tout ce qui est écrit ici est tiré de la documentation officielle ou du code de
 * référence `iframe-examples.js`. Les sources exactes sont dans
 * docs/01-AUDIT.md §2 et §3. Aucun paramètre n'est inventé.
 *
 * Nous ne modifions ni n'importons le code de VDO.Ninja (AGPL-3.0) : nous
 * construisons des URL et envoyons des `postMessage`, qui sont son interface
 * publique documentée.
 */

/**
 * Valeurs de `&quality` **documentées** :
 *   0 → 1920x1080 · 1 → 1280x720 · 2 → 640x360 · -1 → défaut du périphérique
 * Il n'existe pas de palier documenté pour 480p : le profil STANDARD passe donc
 * par `&width`/`&height` explicites, qui sont documentés côté source.
 */
const QUALITY_PRESET: Record<QualityProfileId, number | null> = {
  ECONOMY: 2,
  STANDARD: null, // pas de palier 480p → largeur/hauteur explicites
  BROADCAST: 1,
  HIGH: 0,
}

function params(entries: Array<[string, string | number | boolean | undefined | null]>): string {
  const out: string[] = []
  for (const [key, value] of entries) {
    if (value === undefined || value === null || value === false) continue
    if (value === true) {
      out.push(encodeURIComponent(key))
      continue
    }
    out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
  }
  return out.join('&')
}

export class VdoNinjaEngine implements MediaEngine {
  readonly id: string
  readonly origin: string

  constructor(origin: string, id = 'vdoninja') {
    // Normalise : pas de slash final, origine seule.
    const url = new URL(origin)
    this.origin = url.origin
    this.id = id
  }

  /**
   * Capacités **vérifiées**. Toute valeur `false` ici signifie « non documenté »
   * ou « documenté comme absent », pas « pas encore branché chez nous ».
   */
  readonly capabilities: EngineCapabilities = {
    remoteMicControl: true, // action:"mic"
    remoteCameraControl: true, // action:"camera"
    remoteVolumeControl: true, // action:"volume" (0..200)
    remoteHangup: true, // action:"hangup"
    talkbackUnidirectional: true, // action:"soloChat"
    talkbackBidirectional: true, // action:"soloChatBidirectional"
    directedChat: true, // action:"sendChat" / "sendDirectorChat"
    inboundStats: true, // événement {stats:{inbound:...}}
    loudness: true, // getLoudness / &pushloudness
    bitrateControl: true, // {bitrate, target}
    forceKeyframe: true, // action:"forceKeyframe"
    deviceList: true, // getDeviceList
    sceneAssignment: true, // action:"addScene"
    cleanOutput: true, // &cleanoutput
    // vMix Call fournit un mix-minus à SES participants ; une entrée Web Browser
    // n'en bénéficie pas, et VDO.Ninja ne l'applique pas automatiquement non plus.
    // Le mix-minus est construit explicitement — voir docs/04-AUDIO-MIXMINUS.md.
    nativeMixMinus: false,
    // &retry existe mais la documentation le réserve surtout à Raspberry Ninja.
    // Nous ne promettons donc pas de reconnexion automatique.
    guaranteedReconnect: false,
    ndiOutput: false,
    srtOutput: false,
  }

  // ── URL ─────────────────────────────────────────────────────────────────────

  /**
   * Lien du correspondant.
   *
   * `&view` **sans valeur** est essentiel : il rend le correspondant
   * *publish-only*, donc il n'aspire pas les flux des autres invités. Un
   * `&view=<id>` demanderait un flux et casserait le motif de contribution.
   */
  publisherUrl(ctx: PublisherContext): string {
    const preset = QUALITY_PRESET[ctx.profile.id]
    const query = params([
      ['room', ctx.roomName],
      ['password', ctx.roomSecret],
      ['push', ctx.streamId],
      ['label', ctx.label],
      ['view', ''], // publish-only — valeur volontairement vide
      ['quality', preset ?? undefined],
      ['width', preset === null ? ctx.profile.targetWidth : undefined],
      ['height', preset === null ? ctx.profile.targetHeight : undefined],
      ['maxframerate', ctx.profile.id === 'ECONOMY' ? 25 : 30],
      ['contenthint', ctx.profile.id === 'ECONOMY' ? 'motion' : 'detail'],
      ['videodevice', ctx.videoDeviceId],
      ['audiodevice', ctx.audioDeviceId],
      // TOUJOURS autostart, que les périphériques aient été choisis ou non.
      // Notre salle de préparation a déjà demandé l'autorisation et fait choisir
      // caméra et micro. Sans ce paramètre, le moteur affiche SA propre page
      // « Join Room with… », en anglais, dans la vignette d'incrustation de
      // 176 px : le correspondant croit que la liaison a échoué.
      ['autostart', true],
      ['videomute', ctx.cameraEnabled ? undefined : true],
      ['cleanoutput', true],
    ])
    // `&view` vide : params() le rend sous forme `view=` ; VDO.Ninja traite
    // `&view` avec une valeur vide comme le drapeau publish-only.
    return `${this.origin}/?${query}`
  }

  /** Canal de supervision de la régie. */
  directorUrl(ctx: DirectorContext): string {
    const query = params([
      ['director', ctx.roomName],
      ['password', ctx.roomSecret],
      // La régie n'envoie ni caméra ni micro par ce canal : le talkback utilise
      // soloChat, qui ouvre son propre chemin audio.
      ['cleanish', true],
      ['pushloudness', true],
    ])
    return `${this.origin}/?${query}`
  }

  /**
   * Lien de réception isolé, destiné à un Web Browser Input vMix.
   *
   * `&videobitrate` est un paramètre **côté viewer** : c'est bien ici qu'il faut
   * le poser, pas sur le lien du correspondant. La documentation précise qu'il est
   * inopérant pour un invité en salle de groupe ; `&solo` n'étant pas ce cas,
   * il s'applique.
   */
  receiverUrl(ctx: ReceiverContext): string {
    const query = params([
      ['view', ctx.streamId],
      ['room', ctx.roomName],
      ['password', ctx.roomSecret],
      ['solo', true],
      ['cleanoutput', true],
      ['videobitrate', ctx.profile.videoBitrateKbps],
      ['audiobitrate', ctx.profile.audioBitrateKbps],
      // h264 favorise le décodage matériel dans le CEF de vMix.
      ['codec', 'h264'],
    ])
    return `${this.origin}/?${query}`
  }

  /**
   * Page de publication du retour programme, exécutée dans un **vrai Chrome** sur
   * le PC de régie (pas dans vMix : les permissions micro/caméra du Web Browser
   * Input ne sont pas documentées — cf. docs/01-AUDIT.md §4.1, risque R2).
   *
   * `&view` vide : le bus de retour ne reçoit rien de la salle. C'est la garantie
   * structurelle anti-boucle — aucune voix de correspondant ne peut y revenir.
   */
  returnPublisherUrl(ctx: ReturnContext): string {
    const query = params([
      ['room', ctx.roomName],
      ['password', ctx.roomSecret],
      ['push', ctx.returnStreamId],
      ['label', 'PGM'],
      ['view', ''], // publish-only : anti-boucle par construction
      // proaudio désactive annulation d'écho, réduction de bruit et
      // auto-nivellement : indispensable sur un bus de programme.
      ['proaudio', true],
      ['audiodevice', ctx.audioDeviceId],
      ['videodevice', ctx.audioOnly ? undefined : ctx.videoDeviceId],
      ['novideo', ctx.audioOnly ? true : undefined],
      ['autostart', true],
      ['cleanoutput', true],
    ])
    return `${this.origin}/?${query}`
  }

  /** Vue du retour programme, affichée chez le correspondant. */
  returnViewerUrl(ctx: ReturnViewerContext): string {
    const query = params([
      ['view', ctx.returnStreamId],
      ['room', ctx.roomName],
      ['password', ctx.roomSecret],
      ['solo', true],
      ['cleanoutput', true],
    ])
    return `${this.origin}/?${query}`
  }

  // ── Commandes ───────────────────────────────────────────────────────────────

  encodeGuestCommand(target: string, command: GuestCommand): Record<string, unknown> | null {
    switch (command.kind) {
      case 'mic':
        return { action: 'mic', target, value: command.value }
      case 'camera':
        return { action: 'camera', target, value: command.value }
      case 'volume':
        return { action: 'volume', target, value: clamp(command.value, 0, 200) }
      case 'hangup':
        return { action: 'hangup', target, value: null }
      case 'forceKeyframe':
        return { action: 'forceKeyframe', target, value: null }
      case 'talkback':
        return {
          action: command.bidirectional ? 'soloChatBidirectional' : 'soloChat',
          target,
          value: null,
        }
      case 'chat':
        return { action: 'sendChat', target, value: command.text }
      case 'directorChat':
        return { action: 'sendDirectorChat', target, value: command.text }
      case 'bitrate':
        return { bitrate: clamp(command.kbps, -1, 6000), target }
      default:
        return null
    }
  }

  encodeSelfCommand(command: SelfCommand): Record<string, unknown> | null {
    switch (command.kind) {
      case 'mic':
        return { mic: command.value }
      case 'camera':
        return { camera: command.value }
      case 'speakerMute':
        return { mute: command.value }
      case 'volume':
        return { volume: clamp(command.value, 0, 200) }
      case 'close':
        return { close: true }
      case 'reload':
        return { reload: true }
      case 'requestStats':
        return { getStats: true }
      case 'requestLoudness':
        return { getLoudness: command.enabled }
      case 'requestDeviceList':
        return { getDeviceList: true }
      case 'requestStreamIds':
        return { getStreamIDs: true }
      default:
        return null
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.max(min, Math.min(max, Math.round(value)))
}

let singleton: VdoNinjaEngine | null = null

export function engine(): VdoNinjaEngine {
  if (singleton) return singleton
  const origin = process.env['MEDIA_ENGINE_ORIGIN'] ?? 'https://vdo.ninja'
  singleton = new VdoNinjaEngine(origin, process.env['MEDIA_ENGINE_ID'] ?? 'vdoninja')
  return singleton
}
