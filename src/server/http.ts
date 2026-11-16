import { NextResponse } from 'next/server'
import { ZodError, type ZodType } from 'zod'
import { log } from '@/lib/logger'
import { HttpError } from './auth/guard'
import { VmixError } from '@/lib/vmix/client'

export function json(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, {
    status,
    headers: { 'Cache-Control': 'no-store' },
  })
}

export function problem(status: number, message: string, code = 'error'): NextResponse {
  return json({ error: { code, message } }, status)
}

/**
 * Enveloppe les gestionnaires de route.
 *
 * Objectif : un message d'erreur *unique et générique* sort vers le client pour
 * toute erreur inattendue (pas de pile, pas de requête SQL), tandis que le détail
 * réel part dans les logs serveur. Les erreurs métier, elles, ont un message
 * explicite — un réalisateur en direct doit savoir ce qui est refusé et pourquoi.
 */
export async function handle<T>(fn: () => Promise<T>): Promise<NextResponse> {
  try {
    const result = await fn()
    if (result instanceof NextResponse) return result
    return json(result ?? { ok: true })
  } catch (error) {
    if (error instanceof HttpError) {
      return problem(error.status, error.message, error.code)
    }
    if (error instanceof VmixError) {
      return problem(502, error.message, error.code)
    }
    if (error instanceof ZodError) {
      const first = error.issues[0]
      return problem(
        400,
        first ? `${first.path.join('.') || 'champ'} : ${first.message}` : 'Requête invalide.',
        'invalid_request',
      )
    }
    log.error('route.unhandled', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
    return problem(500, 'Une erreur interne est survenue.', 'internal_error')
  }
}

export async function parseBody<T>(request: Request, schema: ZodType<T>): Promise<T> {
  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    throw new HttpError(400, 'Corps de requête JSON invalide.', 'invalid_request')
  }
  return schema.parse(raw)
}
