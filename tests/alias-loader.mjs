import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Résolution pour l'exécution des tests par Node.
 *
 * Deux écarts entre TypeScript et Node ESM sont comblés ici :
 *
 *  1. l'alias `@/…`, que TypeScript et le bundler de Next connaissent mais pas
 *     Node ;
 *  2. les imports sans extension (`./functions`), optionnels en TypeScript et
 *     obligatoires en ESM.
 *
 * Le choix est délibéré : on adapte l'outillage de test au code de production,
 * pas l'inverse. Dégrader les imports du code applicatif pour satisfaire le
 * lanceur de tests rendrait le code moins lisible sans aucun gain.
 */
const SRC = new URL('../src/', import.meta.url)
const EXTENSIONS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function firstExisting(baseHref) {
  if (existsSync(fileURLToPath(baseHref))) return baseHref
  for (const extension of EXTENSIONS) {
    const candidate = `${baseHref}${extension}`
    if (existsSync(fileURLToPath(candidate))) return candidate
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('@/')) {
    const found = firstExisting(new URL(specifier.slice(2), SRC).href)
    return nextResolve(found ?? new URL(specifier.slice(2), SRC).href, context)
  }

  if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL) {
    const base = new URL(specifier, context.parentURL).href
    // Un specifier déjà complet (avec extension) passe tel quel.
    if (!/\.[a-z0-9]+$/i.test(specifier)) {
      const found = firstExisting(base)
      if (found) return nextResolve(found, context)
    }
  }

  return nextResolve(specifier, context)
}
