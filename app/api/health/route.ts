import { db } from '@/lib/db'
import { json } from '@/server/http'

export const dynamic = 'force-dynamic'

/**
 * Sonde de santé. Vérifie réellement la base : un endpoint qui répond
 * « ok » sans rien tester ne sert à rien en supervision.
 */
export async function GET() {
  const started = Date.now()
  try {
    await db.$queryRaw`SELECT 1`
    return json({ status: 'ok', database: 'ok', latencyMs: Date.now() - started })
  } catch (error) {
    return json(
      {
        status: 'degraded',
        database: 'unreachable',
        latencyMs: Date.now() - started,
        detail: error instanceof Error ? error.message : 'erreur inconnue',
      },
      503,
    )
  }
}
