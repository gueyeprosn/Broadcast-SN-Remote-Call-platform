import type { Capability } from '@/lib/rbac'

/**
 * Liste blanche des fonctions vMix.
 *
 * Toute fonction absente de cette table est refusée **avant** tout appel réseau.
 * Les noms et les paramètres viennent du Shortcut Function Reference officiel
 * (docs/01-AUDIT.md §4.2) — aucun n'est inventé.
 */

export type RiskLevel = 'SAFE' | 'AUDIO' | 'PROGRAM' | 'DESTRUCTIVE'

export interface VmixFunctionSpec {
  /** Nom exact de la fonction vMix. Sensible à la casse. */
  name: string
  risk: RiskLevel
  /** Capacité applicative requise. */
  capability: Capability
  /** La fonction a besoin d'un paramètre `Input`. */
  needsInput: boolean
  /** La fonction a besoin d'un paramètre `Value`. */
  needsValue: boolean
  /** Validation du `Value` attendu, si applicable. */
  validateValue?: (value: string) => string | null
  description: string
  /**
   * `true` si la fonction n'est pas documentée officiellement pour cet usage.
   * L'interface doit le signaler et ne jamais la présenter comme garantie.
   */
  unverified?: boolean
}

const BUSES = ['M', 'A', 'B', 'C', 'D', 'E', 'F', 'G']

function validateBus(value: string): string | null {
  return BUSES.includes(value.toUpperCase())
    ? null
    : `Bus invalide « ${value} ». Attendu : ${BUSES.join(', ')}.`
}

function validateVolume(value: string): string | null {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    return 'SetVolume attend une valeur entre 0 et 100.'
  }
  return null
}

function validateHttpUrl(value: string): string | null {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return 'Seules les URL http(s) sont acceptées.'
    }
    return null
  } catch {
    return 'URL invalide.'
  }
}

export const VMIX_FUNCTIONS: Record<string, VmixFunctionSpec> = {
  // ── Navigateur ──────────────────────────────────────────────────────────────
  BrowserNavigate: {
    name: 'BrowserNavigate',
    risk: 'SAFE',
    capability: 'vmix.navigate',
    needsInput: true,
    needsValue: true,
    validateValue: validateHttpUrl,
    description: "Change l'URL d'une entrée Web Browser existante.",
  },
  BrowserReload: {
    name: 'BrowserReload',
    risk: 'SAFE',
    capability: 'vmix.navigate',
    needsInput: true,
    needsValue: false,
    description: 'Recharge la page de l’entrée Web Browser.',
  },
  SetInputName: {
    name: 'SetInputName',
    risk: 'SAFE',
    capability: 'vmix.navigate',
    needsInput: true,
    needsValue: true,
    validateValue: (v) => (v.trim().length === 0 ? 'Le nom ne peut pas être vide.' : null),
    description: 'Renomme une entrée.',
  },

  // ── Audio ───────────────────────────────────────────────────────────────────
  AudioOn: {
    name: 'AudioOn',
    risk: 'AUDIO',
    capability: 'vmix.audio',
    needsInput: true,
    needsValue: false,
    description: 'Active l’audio de l’entrée dans vMix. N’affecte pas l’émission du correspondant.',
  },
  AudioOff: {
    name: 'AudioOff',
    risk: 'AUDIO',
    capability: 'vmix.audio',
    needsInput: true,
    needsValue: false,
    description: 'Coupe l’audio de l’entrée dans vMix. Le correspondant continue d’émettre.',
  },
  SetVolume: {
    name: 'SetVolume',
    risk: 'AUDIO',
    capability: 'vmix.audio',
    needsInput: true,
    needsValue: true,
    validateValue: validateVolume,
    description: 'Règle le volume de l’entrée (0–100).',
  },
  AudioBusOn: {
    name: 'AudioBusOn',
    risk: 'AUDIO',
    capability: 'vmix.audio',
    needsInput: true,
    needsValue: true,
    validateValue: validateBus,
    description: 'Envoie l’entrée vers un bus (M, A–G).',
  },
  AudioBusOff: {
    name: 'AudioBusOff',
    risk: 'AUDIO',
    capability: 'vmix.audio',
    needsInput: true,
    needsValue: true,
    validateValue: validateBus,
    description: 'Retire l’entrée d’un bus — c’est l’opération du mix-minus.',
  },
  SoloOn: {
    name: 'SoloOn',
    risk: 'AUDIO',
    capability: 'vmix.audio',
    needsInput: true,
    needsValue: false,
    description: 'Écoute isolée d’une entrée au casque.',
  },
  SoloOff: {
    name: 'SoloOff',
    risk: 'AUDIO',
    capability: 'vmix.audio',
    needsInput: true,
    needsValue: false,
    description: 'Arrête l’écoute isolée.',
  },
  SoloAllOff: {
    name: 'SoloAllOff',
    risk: 'AUDIO',
    capability: 'vmix.audio',
    needsInput: false,
    needsValue: false,
    description: 'Arrête toutes les écoutes isolées.',
  },

  // ── Program ─────────────────────────────────────────────────────────────────
  Cut: {
    name: 'Cut',
    risk: 'PROGRAM',
    capability: 'vmix.program',
    needsInput: false,
    needsValue: false,
    description: 'Coupe franche Preview → Program. Affecte l’antenne.',
  },
  Fade: {
    name: 'Fade',
    risk: 'PROGRAM',
    capability: 'vmix.program',
    needsInput: false,
    needsValue: false,
    description: 'Fondu Preview → Program. Affecte l’antenne.',
  },
  PreviewInput: {
    name: 'PreviewInput',
    risk: 'PROGRAM',
    capability: 'vmix.program',
    needsInput: true,
    needsValue: false,
    description: 'Place une entrée en Preview.',
  },

  // ── Destructif ──────────────────────────────────────────────────────────────
  AddInput: {
    name: 'AddInput',
    risk: 'DESTRUCTIVE',
    capability: 'vmix.manage',
    needsInput: false,
    needsValue: true,
    validateValue: (v) =>
      v.startsWith('Browser|') ? null : 'AddInput n’est autorisé qu’au format « Browser|<url> ».',
    description:
      'Crée une entrée. NON DOCUMENTÉ pour le type Browser : à ne pas considérer comme garanti.',
    unverified: true,
  },
  RemoveInput: {
    name: 'RemoveInput',
    risk: 'DESTRUCTIVE',
    capability: 'vmix.manage',
    needsInput: true,
    needsValue: false,
    description: 'Supprime une entrée de vMix. Irréversible depuis l’application.',
  },
}

export interface FunctionCheck {
  ok: boolean
  reason?: string
  spec?: VmixFunctionSpec
}

export function checkFunction(
  name: string,
  options: { input?: string | undefined; value?: string | undefined },
): FunctionCheck {
  const spec = VMIX_FUNCTIONS[name]
  if (!spec) {
    return { ok: false, reason: `Fonction vMix « ${name} » non autorisée par la liste blanche.` }
  }
  if (spec.needsInput && !options.input) {
    return { ok: false, reason: `${name} exige un paramètre Input.`, spec }
  }
  if (spec.needsValue && options.value === undefined) {
    return { ok: false, reason: `${name} exige un paramètre Value.`, spec }
  }
  if (spec.validateValue && options.value !== undefined) {
    const problem = spec.validateValue(options.value)
    if (problem) return { ok: false, reason: problem, spec }
  }
  return { ok: true, spec }
}

/**
 * Garde anti-boucle : `BusXSendToMaster` renverrait un bus de retour vers le
 * Master, ce qui rebouclerait le programme sur lui-même. La fonction n'est pas
 * dans la liste blanche, et ce garde documente l'interdiction explicitement.
 */
export function isForbiddenBusRouting(name: string, value: string | undefined): boolean {
  return name === 'BusXSendToMaster' || (name === 'BusXAudio' && value === undefined)
}
