import { log } from '@/lib/logger'
import { checkFunction, isForbiddenBusRouting, type VmixFunctionSpec } from './functions'
import { parseVmixState, type VmixState } from './xml'

/**
 * Client de l'API HTTP vMix.
 *
 * Deux règles non négociables, appliquées **à l'exécution** et pas seulement
 * documentées :
 *
 *  1. L'API vMix ne documente aucune authentification. En mode DIRECT, l'hôte
 *     doit donc être une adresse privée ou de bouclage. Une adresse publique est
 *     refusée — on ne pilote pas une antenne à travers Internet en clair.
 *  2. Toute fonction passe par la liste blanche de `functions.ts`.
 */

export type VmixErrorCode =
  | 'forbidden_host'
  | 'forbidden_function'
  | 'invalid_argument'
  | 'unreachable'
  | 'timeout'
  | 'vmix_error'
  | 'bad_response'

export class VmixError extends Error {
  readonly code: VmixErrorCode

  // Pas de propriété de paramètre (`readonly code` dans la signature) : Node
  // exécute les tests avec --experimental-strip-types, qui ne sait que retirer
  // les annotations de type et refuse cette syntaxe.
  constructor(message: string, code: VmixErrorCode) {
    super(message)
    this.name = 'VmixError'
    this.code = code
  }
}

const PRIVATE_V4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
]

/**
 * Vrai si l'hôte est une adresse de réseau local ou de bouclage.
 * Les noms d'hôte non littéraux (`vmix-regie.local`, `localhost`) sont acceptés
 * uniquement s'ils sont explicitement locaux : un nom DNS public pourrait
 * pointer n'importe où.
 */
export function isPrivateHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '::1' || h === '0:0:0:0:0:0:0:1') return true
  if (h.endsWith('.local') || h.endsWith('.localhost')) return true
  if (PRIVATE_V4.some((re) => re.test(h))) return true
  // IPv6 unique-local (fc00::/7) et link-local (fe80::/10).
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true
  if (/^fe[89ab][0-9a-f]:/.test(h)) return true
  return false
}

export interface VmixTarget {
  host: string
  port: number
  mode: 'DIRECT' | 'AGENT'
  /** Base de l'agent local, p.ex. `https://agent.regie.local:8443`. */
  agentBaseUrl?: string | undefined
  agentToken?: string | undefined
  timeoutMs?: number | undefined
}

export interface CallOptions {
  input?: string | undefined
  value?: string | undefined
  duration?: number | undefined
  mix?: number | undefined
  /** Bus déclarés comme bus de retour — `BusXSendToMaster` y est refusé. */
  returnBuses?: string[] | undefined
}

function baseUrl(target: VmixTarget): string {
  if (target.mode === 'AGENT') {
    if (!target.agentBaseUrl) {
      throw new VmixError("Mode AGENT sans adresse d'agent configurée.", 'invalid_argument')
    }
    return target.agentBaseUrl.replace(/\/+$/, '') + '/vmix'
  }
  if (!isPrivateHost(target.host)) {
    throw new VmixError(
      `Refusé : « ${target.host} » n'est pas une adresse de réseau local. ` +
        "L'API vMix ne documente aucune authentification et ne doit jamais être " +
        "joignable depuis Internet. Utilisez le mode AGENT.",
      'forbidden_host',
    )
  }
  return `http://${target.host}:${target.port}/api/`
}

async function request(url: string, target: VmixTarget): Promise<string> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), target.timeoutMs ?? 4000)
  try {
    const headers: Record<string, string> = { Accept: 'text/xml, application/xml, text/plain' }
    // Le secret de l'agent circule dans un en-tête, jamais dans l'URL.
    if (target.mode === 'AGENT' && target.agentToken) {
      headers['X-SNRC-Agent-Token'] = target.agentToken
    }
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'error',
    })
    const body = await response.text()
    if (response.status === 500) {
      throw new VmixError(
        `vMix a refusé la commande (HTTP 500). Réponse : ${body.slice(0, 200) || '(vide)'}`,
        'vmix_error',
      )
    }
    if (!response.ok) {
      throw new VmixError(`Réponse inattendue de vMix : HTTP ${response.status}.`, 'bad_response')
    }
    return body
  } catch (error) {
    if (error instanceof VmixError) throw error
    if (error instanceof Error && error.name === 'AbortError') {
      throw new VmixError(
        `vMix n'a pas répondu en ${target.timeoutMs ?? 4000} ms.`,
        'timeout',
      )
    }
    throw new VmixError(
      `vMix est injoignable : ${error instanceof Error ? error.message : String(error)}`,
      'unreachable',
    )
  } finally {
    clearTimeout(timeout)
  }
}

/** Lit l'état complet de vMix. */
export async function getState(target: VmixTarget): Promise<VmixState> {
  const body = await request(baseUrl(target), target)
  try {
    return parseVmixState(body)
  } catch (error) {
    throw new VmixError(
      `État vMix illisible : ${error instanceof Error ? error.message : String(error)}`,
      'bad_response',
    )
  }
}

export interface CallResult {
  spec: VmixFunctionSpec
  url: string
}

/**
 * Appelle une fonction vMix après validation complète.
 *
 * L'URL est construite avec `URLSearchParams`, qui percent-encode `?`, `&` et `#`.
 * C'est nécessaire : la documentation signale que ces caractères cassent
 * `BrowserNavigate` s'ils ne sont pas encodés.
 */
export async function callFunction(
  target: VmixTarget,
  name: string,
  options: CallOptions = {},
): Promise<CallResult> {
  if (isForbiddenBusRouting(name, options.value)) {
    throw new VmixError(
      `${name} est interdit : renvoyer un bus de retour vers le Master créerait ` +
        'une boucle de programme.',
      'forbidden_function',
    )
  }

  const check = checkFunction(name, { input: options.input, value: options.value })
  if (!check.ok || !check.spec) {
    throw new VmixError(check.reason ?? 'Fonction refusée.', 'forbidden_function')
  }
  const spec = check.spec

  if (
    options.value &&
    options.returnBuses?.some((bus) => bus.toUpperCase() === options.value?.toUpperCase()) &&
    name === 'AudioBusOn'
  ) {
    // Garde explicite : on n'ajoute pas une source au bus de retour par l'API
    // sans savoir si c'est un correspondant (ce serait un mix-minus cassé).
    log.warn('vmix.return_bus_write', { name, value: options.value })
  }

  const search = new URLSearchParams()
  search.set('Function', spec.name)
  if (options.input) search.set('Input', options.input)
  if (options.value !== undefined) search.set('Value', options.value)
  if (options.duration !== undefined) search.set('Duration', String(options.duration))
  if (options.mix !== undefined) search.set('Mix', String(options.mix))

  const url = `${baseUrl(target)}?${search.toString()}`
  await request(url, target)
  log.info('vmix.call', { function: spec.name, risk: spec.risk, input: options.input })
  return { spec, url }
}

/**
 * Sérialisation des commandes par entrée.
 *
 * Limite rapportée par les utilisateurs de vMix : plusieurs commandes envoyées
 * trop vite à une même entrée navigateur peuvent être perdues, la page n'ayant
 * pas fini de charger. On espace donc les commandes qui visent la même entrée.
 */
const lastCallAt = new Map<string, number>()
const MIN_GAP_MS = 750

export async function callFunctionSerialized(
  target: VmixTarget,
  name: string,
  options: CallOptions = {},
): Promise<CallResult> {
  const key = `${target.host}:${target.port}:${options.input ?? '-'}`
  const previous = lastCallAt.get(key) ?? 0
  const wait = previous + MIN_GAP_MS - Date.now()
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
  try {
    return await callFunction(target, name, options)
  } finally {
    lastCallAt.set(key, Date.now())
  }
}
