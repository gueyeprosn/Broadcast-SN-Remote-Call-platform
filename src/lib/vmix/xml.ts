/**
 * Lecture de l'état vMix (`GET /api/` sans paramètre).
 *
 * Analyseur minimal volontaire : pas de dépendance XML externe, pas de
 * résolution d'entité externe (XXE impossible), et on n'extrait que les champs
 * dont on a besoin. La réponse vient d'une machine de régie de confiance, mais
 * on la traite tout de même comme une entrée à valider.
 */

export interface VmixInput {
  key: string
  number: number | null
  type: string | null
  title: string
  /** `true` si l'entrée est de type Web Browser — candidate au mapping. */
  isBrowser: boolean
}

export interface VmixState {
  version: string | null
  edition: string | null
  /** Numéro de l'entrée au Program. */
  activeNumber: number | null
  previewNumber: number | null
  inputs: VmixInput[]
  /** Numéros d'entrée présents dans un overlay actif. */
  overlayInputNumbers: number[]
}

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
}

function unescapeXml(input: string): string {
  return input.replace(/&(?:amp|lt|gt|quot|apos|#39);/g, (m) => ENTITIES[m] ?? m)
}

function attribute(tag: string, name: string): string | null {
  const match = new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i').exec(tag)
  return match?.[1] !== undefined ? unescapeXml(match[1]) : null
}

function textOf(xml: string, tagName: string): string | null {
  const match = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`, 'i').exec(xml)
  return match?.[1] !== undefined ? unescapeXml(match[1].trim()) : null
}

function intOf(value: string | null): number | null {
  if (value === null) return null
  const n = Number.parseInt(value, 10)
  return Number.isFinite(n) ? n : null
}

export function parseVmixState(xml: string): VmixState {
  if (!xml.includes('<vmix')) {
    throw new Error("La réponse ne ressemble pas à un état vMix (élément <vmix> absent).")
  }

  const inputs: VmixInput[] = []
  const inputsBlock = /<inputs>([\s\S]*?)<\/inputs>/i.exec(xml)?.[1] ?? ''
  // Les entrées peuvent être auto-fermées ou contenir des sous-éléments.
  const inputRegex = /<input\b([^>]*?)(\/?)>([\s\S]*?)(?:<\/input>|(?=<input\b)|$)/gi
  let match: RegExpExecArray | null
  while ((match = inputRegex.exec(inputsBlock)) !== null) {
    const attrs = match[1] ?? ''
    const key = attribute(attrs, 'key')
    if (!key) continue
    const type = attribute(attrs, 'type')
    const titleAttr = attribute(attrs, 'title')
    const inner = (match[3] ?? '').replace(/<[^>]*>/g, '').trim()
    inputs.push({
      key,
      number: intOf(attribute(attrs, 'number')),
      type,
      title: titleAttr ?? (unescapeXml(inner) || key),
      isBrowser: (type ?? '').toLowerCase().includes('browser'),
    })
  }

  const overlayNumbers: number[] = []
  const overlaysBlock = /<overlays>([\s\S]*?)<\/overlays>/i.exec(xml)?.[1] ?? ''
  const overlayRegex = /<overlay\b[^>]*>([\s\S]*?)<\/overlay>/gi
  let overlay: RegExpExecArray | null
  while ((overlay = overlayRegex.exec(overlaysBlock)) !== null) {
    const n = intOf((overlay[1] ?? '').trim())
    if (n !== null) overlayNumbers.push(n)
  }

  return {
    version: textOf(xml, 'version'),
    edition: textOf(xml, 'edition'),
    activeNumber: intOf(textOf(xml, 'active')),
    previewNumber: intOf(textOf(xml, 'preview')),
    inputs,
    overlayInputNumbers: overlayNumbers,
  }
}
