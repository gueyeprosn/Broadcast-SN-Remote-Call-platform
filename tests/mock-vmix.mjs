#!/usr/bin/env node
/**
 * Simulateur d'API HTTP vMix — pour les tests.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE N'EST PAS vMix. Il reproduit uniquement la forme documentée de l'API  │
 * │ (vmix.com/help29/DeveloperAPI.html) afin d'exercer NOTRE code : lecture  │
 * │ du XML, construction et encodage des commandes, mapping des entrées,     │
 * │ synchronisation ON AIR, gestion des erreurs.                             │
 * │                                                                          │
 * │ Un test qui passe ici prouve que notre client est correct. Il ne prouve  │
 * │ RIEN sur le comportement réel de vMix. Les points qui exigent une vraie  │
 * │ installation Windows sont listés dans docs/10-TEST-REPORT.md.            │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Usage :  node tests/mock-vmix.mjs [port]
 *   GET /api/                       → état XML
 *   GET /api/?Function=…            → 200, et la commande est enregistrée
 *   GET /_calls                     → journal JSON des commandes reçues
 *   POST /_program?input=3          → place une entrée au Program
 *   POST /_reset                    → vide le journal
 */
import { createServer } from 'node:http'

const port = Number(process.argv[2] ?? 8088)

const state = {
  version: '29.0.0.70',
  edition: '4K',
  preview: 2,
  active: 1,
  overlays: [],
  inputs: [
    { key: '11111111-1111-1111-1111-111111111111', number: 1, type: 'Colour', title: 'Fond' },
    { key: '22222222-2222-2222-2222-222222222222', number: 2, type: 'Browser', title: 'Navigateur 1' },
    { key: '33333333-3333-3333-3333-333333333333', number: 3, type: 'Browser', title: 'Navigateur 2' },
    { key: '44444444-4444-4444-4444-444444444444', number: 4, type: 'Capture', title: 'Caméra plateau' },
  ],
}

/** Journal des commandes reçues : c'est ce que les tests inspectent. */
const calls = []

const escapeXml = (value) =>
  String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])

function renderState() {
  const inputs = state.inputs
    .map(
      (input) =>
        `    <input key="${input.key}" number="${input.number}" type="${input.type}" ` +
        `title="${escapeXml(input.title)}">${escapeXml(input.title)}</input>`,
    )
    .join('\n')
  const overlays = [1, 2, 3, 4]
    .map((n) => {
      const value = state.overlays.find((o) => o.number === n)
      return `    <overlay number="${n}">${value ? value.input : ''}</overlay>`
    })
    .join('\n')
  return `<?xml version="1.0" encoding="utf-8"?>
<vmix>
  <version>${state.version}</version>
  <edition>${state.edition}</edition>
  <preset></preset>
  <inputs>
${inputs}
  </inputs>
  <overlays>
${overlays}
  </overlays>
  <preview>${state.preview}</preview>
  <active>${state.active}</active>
  <fadeToBlack>False</fadeToBlack>
  <transitions>
    <transition number="1" effect="Fade" duration="500" />
  </transitions>
</vmix>`
}

/** Reproduit la résolution d'`Input` documentée : numéro, GUID, ou titre exact. */
function resolveInput(reference) {
  if (!reference) return null
  const asNumber = Number(reference)
  if (Number.isInteger(asNumber)) {
    return state.inputs.find((input) => input.number === asNumber) ?? null
  }
  return (
    state.inputs.find((input) => input.key === reference) ??
    // Le titre est sensible à la casse, comme le précise la documentation.
    state.inputs.find((input) => input.title === reference) ??
    null
  )
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', `http://localhost:${port}`)

  if (url.pathname === '/_calls') {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    return response.end(JSON.stringify(calls))
  }
  if (url.pathname === '/_reset') {
    calls.length = 0
    state.overlays = []
    state.active = 1
    response.writeHead(200, { 'Content-Type': 'application/json' })
    return response.end(JSON.stringify({ ok: true }))
  }
  if (url.pathname === '/_program') {
    state.active = Number(url.searchParams.get('input') ?? 1)
    response.writeHead(200, { 'Content-Type': 'application/json' })
    return response.end(JSON.stringify({ active: state.active }))
  }

  if (!url.pathname.toLowerCase().startsWith('/api')) {
    response.writeHead(404)
    return response.end('Not found')
  }

  const fn = url.searchParams.get('Function')

  // Sans paramètre : état complet, comme le documente vMix.
  if (!fn) {
    response.writeHead(200, { 'Content-Type': 'text/xml; charset=utf-8' })
    return response.end(renderState())
  }

  const inputRef = url.searchParams.get('Input')
  const value = url.searchParams.get('Value')
  const input = resolveInput(inputRef)
  calls.push({
    at: new Date().toISOString(),
    function: fn,
    input: inputRef,
    resolvedInput: input ? input.number : null,
    value,
    rawQuery: url.search,
  })

  // vMix renvoie 500 pour une commande refusée, 200 sinon. On reproduit les
  // refus les plus courants : entrée inexistante, type inadapté.
  const needsInput = /^(Browser|Audio|SetVolume|Solo|SetInputName|PreviewInput|RemoveInput)/.test(fn)
  if (needsInput && !input) {
    response.writeHead(500, { 'Content-Type': 'text/plain' })
    return response.end(`Input not found: ${inputRef}`)
  }
  if (fn.startsWith('Browser') && input && input.type !== 'Browser') {
    response.writeHead(500, { 'Content-Type': 'text/plain' })
    return response.end(`Input ${input.number} is not a Web Browser input`)
  }
  if (fn === 'SetInputName' && input && value) input.title = value
  if (fn === 'PreviewInput' && input) state.preview = input.number
  if (fn === 'Cut') {
    const previous = state.active
    state.active = state.preview
    state.preview = previous
  }

  response.writeHead(200, { 'Content-Type': 'text/plain' })
  response.end('')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`[mock-vmix] écoute sur 127.0.0.1:${port} — CE N'EST PAS vMix`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}
