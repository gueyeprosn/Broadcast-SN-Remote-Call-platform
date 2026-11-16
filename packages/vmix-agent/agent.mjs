#!/usr/bin/env node
/**
 * Broadcast SN Remote Call — agent vMix local
 *
 * Tourne sur le PC de régie, à côté de vMix. Il existe pour une seule raison :
 * l'API HTTP de vMix ne documente **aucune authentification**. L'exposer au-delà
 * de la machine, a fortiori à Internet, permettrait à n'importe qui de couper
 * l'antenne.
 *
 * L'agent ajoute donc les trois choses qui manquent :
 *   1. un secret partagé, comparé à temps constant ;
 *   2. sa PROPRE liste blanche de fonctions, indépendante de celle du serveur —
 *      un serveur applicatif compromis ne peut pas lui faire exécuter
 *      `RemoveInput` ;
 *   3. une journalisation locale de chaque commande acceptée ou refusée.
 *
 * Il n'ouvre lui-même aucune connexion sortante : il écoute, par défaut sur la
 * boucle locale. Pour une régie derrière un NAT, la variante « tunnel sortant »
 * est décrite dans le README mais n'est pas implémentée ici.
 *
 * Aucune dépendance : Node 20+ suffit.
 */
import { createServer as createHttpServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { timingSafeEqual, createHash } from 'node:crypto'

// ── Configuration ─────────────────────────────────────────────────────────────

const config = {
  token: process.env.SNRC_AGENT_TOKEN ?? '',
  bind: process.env.AGENT_BIND ?? '127.0.0.1',
  port: Number(process.env.AGENT_PORT ?? 8099),
  vmixHost: process.env.VMIX_HOST ?? '127.0.0.1',
  vmixPort: Number(process.env.VMIX_PORT ?? 8088),
  timeoutMs: Number(process.env.VMIX_TIMEOUT_MS ?? 4000),
  tlsCert: process.env.AGENT_TLS_CERT ?? '',
  tlsKey: process.env.AGENT_TLS_KEY ?? '',
  // Garde-fous, fermés par défaut. Un direct ne se pilote pas par accident.
  allowAddInput: process.env.AGENT_ALLOW_ADD_INPUT === 'true',
  allowProgram: process.env.AGENT_ALLOW_PROGRAM === 'true',
  allowRemoveInput: process.env.AGENT_ALLOW_REMOVE_INPUT === 'true',
  // Bus déclarés comme bus de RETOUR : on refuse d'y router une source.
  returnBuses: (process.env.AGENT_RETURN_BUSES ?? 'A')
    .split(',')
    .map((bus) => bus.trim().toUpperCase())
    .filter(Boolean),
}

if (config.token.length < 24) {
  console.error(
    'SNRC_AGENT_TOKEN est absent ou trop court (24 caractères minimum).\n' +
      "Générez-le avec :  node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"\n" +
      'et renseignez la MÊME valeur dans VMIX_AGENT_TOKEN côté application.',
  )
  process.exit(2)
}

if (config.bind !== '127.0.0.1' && config.bind !== 'localhost' && !config.tlsCert) {
  console.error(
    `Refus de démarrer : AGENT_BIND=${config.bind} expose l'agent sur le réseau ` +
      'sans TLS, donc le secret partagé circulerait en clair.\n' +
      'Fournissez AGENT_TLS_CERT et AGENT_TLS_KEY, ou laissez AGENT_BIND=127.0.0.1.',
  )
  process.exit(2)
}

// ── Liste blanche propre à l'agent ────────────────────────────────────────────
// Volontairement redondante avec celle du serveur : c'est le but. L'agent est la
// dernière barrière devant l'antenne.

const SAFE = new Set([
  'BrowserNavigate',
  'BrowserReload',
  'BrowserBack',
  'BrowserForward',
  'SetInputName',
])
const AUDIO = new Set([
  'Audio',
  'AudioOn',
  'AudioOff',
  'SetVolume',
  'AudioAuto',
  'AudioAutoOn',
  'AudioAutoOff',
  'AudioBus',
  'AudioBusOn',
  'AudioBusOff',
  'SoloOn',
  'SoloOff',
  'SoloAllOff',
])
const PROGRAM = new Set(['Cut', 'Fade', 'PreviewInput', 'Transition1', 'Transition2'])
const DESTRUCTIVE = new Set(['AddInput', 'RemoveInput'])

// Jamais, sous aucune condition : renverrait un bus de retour vers le Master et
// créerait une boucle de programme.
const NEVER = new Set(['BusXSendToMaster', 'Shutdown', 'Restart', 'ScriptStart', 'ScriptStartDynamic'])

function authorize(fn, params) {
  if (!fn) return { ok: true, kind: 'state' } // lecture de l'état XML
  if (NEVER.has(fn)) {
    return { ok: false, reason: `${fn} est interdit par l'agent (boucle ou exécution de script).` }
  }
  if (SAFE.has(fn)) return { ok: true, kind: 'SAFE' }
  if (AUDIO.has(fn)) {
    const bus = (params.get('Value') ?? '').toUpperCase()
    if (fn === 'AudioBusOn' && config.returnBuses.includes(bus)) {
      return {
        ok: false,
        reason:
          `Refus : le bus ${bus} est déclaré bus de retour. Y ajouter une source ` +
          "casserait le mix-minus (un correspondant s'entendrait lui-même).",
      }
    }
    if (fn === 'SetVolume') {
      const value = Number(params.get('Value'))
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        return { ok: false, reason: 'SetVolume attend une valeur entre 0 et 100.' }
      }
    }
    return { ok: true, kind: 'AUDIO' }
  }
  if (PROGRAM.has(fn)) {
    return config.allowProgram
      ? { ok: true, kind: 'PROGRAM' }
      : { ok: false, reason: `${fn} affecte l'antenne : activez AGENT_ALLOW_PROGRAM=true.` }
  }
  if (DESTRUCTIVE.has(fn)) {
    if (fn === 'AddInput') {
      if (!config.allowAddInput) {
        return {
          ok: false,
          reason:
            "AddInput n'est pas documenté pour le type Browser : activez " +
            'AGENT_ALLOW_ADD_INPUT=true seulement après l\'avoir vérifié.',
        }
      }
      const value = params.get('Value') ?? ''
      if (!value.startsWith('Browser|')) {
        return { ok: false, reason: 'AddInput est restreint au format « Browser|<url> ».' }
      }
      return { ok: true, kind: 'DESTRUCTIVE' }
    }
    return config.allowRemoveInput
      ? { ok: true, kind: 'DESTRUCTIVE' }
      : { ok: false, reason: 'RemoveInput est désactivé : AGENT_ALLOW_REMOVE_INPUT=true.' }
  }
  return { ok: false, reason: `Fonction « ${fn} » absente de la liste blanche de l'agent.` }
}

// ── Authentification ──────────────────────────────────────────────────────────

const expected = createHash('sha256').update(config.token, 'utf8').digest()

function tokenValid(presented) {
  if (typeof presented !== 'string' || presented.length === 0) return false
  const given = createHash('sha256').update(presented, 'utf8').digest()
  return timingSafeEqual(given, expected)
}

// ── Limitation de débit ───────────────────────────────────────────────────────

const hits = []
function rateLimited() {
  const now = Date.now()
  while (hits.length > 0 && now - hits[0] > 10_000) hits.shift()
  if (hits.length >= 60) return true
  hits.push(now)
  return false
}

// ── Journal ───────────────────────────────────────────────────────────────────

function log(level, message, meta = {}) {
  console.log(
    JSON.stringify({ ts: new Date().toISOString(), level, msg: message, ...meta }),
  )
}

// ── Relais vers vMix ──────────────────────────────────────────────────────────

async function callVmix(search) {
  const url = `http://${config.vmixHost}:${config.vmixPort}/api/${search ? `?${search}` : ''}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' })
    return { status: response.status, body: await response.text() }
  } finally {
    clearTimeout(timer)
  }
}

// ── Serveur ───────────────────────────────────────────────────────────────────

const handler = async (request, response) => {
  const send = (status, payload, type = 'application/json; charset=utf-8') => {
    response.writeHead(status, {
      'Content-Type': type,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    })
    response.end(typeof payload === 'string' ? payload : JSON.stringify(payload))
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)

  if (url.pathname === '/health') {
    return send(200, { status: 'ok', vmix: `${config.vmixHost}:${config.vmixPort}` })
  }

  if (url.pathname !== '/vmix') return send(404, { error: 'Chemin inconnu.' })
  if (request.method !== 'GET') return send(405, { error: 'GET uniquement.' })

  if (!tokenValid(request.headers['x-snrc-agent-token'])) {
    log('warn', 'agent.auth_failed', { ip: request.socket.remoteAddress })
    return send(401, { error: 'Secret d’agent invalide.' })
  }

  if (rateLimited()) {
    log('warn', 'agent.rate_limited')
    return send(429, { error: 'Trop de commandes. Ralentissez.' })
  }

  const fn = url.searchParams.get('Function')
  const verdict = authorize(fn, url.searchParams)
  if (!verdict.ok) {
    log('warn', 'agent.refused', { function: fn, reason: verdict.reason })
    return send(403, { error: verdict.reason })
  }

  try {
    const result = await callVmix(url.searchParams.toString())
    log('info', 'agent.forwarded', {
      function: fn ?? '(état)',
      kind: verdict.kind,
      input: url.searchParams.get('Input'),
      status: result.status,
    })
    return send(
      result.status,
      result.body,
      fn ? 'text/plain; charset=utf-8' : 'text/xml; charset=utf-8',
    )
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'vMix n’a pas répondu à temps.' : String(error)
    log('error', 'agent.vmix_unreachable', { function: fn, reason })
    return send(502, { error: `vMix est injoignable : ${reason}` })
  }
}

const server = config.tlsCert
  ? createHttpsServer(
      { cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) },
      handler,
    )
  : createHttpServer(handler)

server.listen(config.port, config.bind, () => {
  log('info', 'agent.started', {
    bind: `${config.bind}:${config.port}`,
    tls: Boolean(config.tlsCert),
    vmix: `${config.vmixHost}:${config.vmixPort}`,
    allowProgram: config.allowProgram,
    allowAddInput: config.allowAddInput,
    allowRemoveInput: config.allowRemoveInput,
    returnBuses: config.returnBuses,
  })
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('info', 'agent.stopping', { signal })
    server.close(() => process.exit(0))
  })
}
