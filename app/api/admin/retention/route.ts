import { createHash, timingSafeEqual } from 'node:crypto'
import { env } from '@/lib/env'
import { currentUser, requireCapability } from '@/server/auth/guard'
import { can } from '@/lib/rbac'
import { handle, json, problem } from '@/server/http'
import { audit, requestContext } from '@/server/services/audit'
import { clientIp, enforce } from '@/server/services/ratelimit'
import { retentionStatus, runRetention } from '@/server/services/retention'

export const dynamic = 'force-dynamic'

const CRON_HEADER = 'x-snrc-cron-token'

/** Comparaison à temps constant du secret de planificateur. */
function cronTokenValid(presented: string | null): boolean {
  const expected = env().CRON_SECRET
  if (!expected || !presented) return false
  const a = createHash('sha256').update(presented, 'utf8').digest()
  const b = createHash('sha256').update(expected, 'utf8').digest()
  return timingSafeEqual(a, b)
}

/** État de la rétention : ce qui sera supprimé, et quand. */
export async function GET() {
  return handle(async () => {
    await requireCapability('retention.read')
    return json({ status: await retentionStatus() })
  })
}

/**
 * Lance la purge.
 *
 * Deux déclencheurs, et un seul chemin de code :
 *  - une session **administrateur** (bouton de la console) ;
 *  - un **planificateur**, par l'en-tête `X-SNRC-Cron-Token`. Ce chemin n'existe
 *    que si `CRON_SECRET` est renseigné : sans secret, la purge automatique est
 *    simplement indisponible, plutôt qu'ouverte.
 *
 * Le secret voyage dans un en-tête, jamais dans l'URL, qui finirait dans les
 * journaux d'accès de Nginx.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const context = requestContext(request.headers)
    const ip = clientIp(request.headers)
    const presented = request.headers.get(CRON_HEADER)

    if (presented !== null) {
      // Freine les essais de devinette du secret.
      await enforce({ key: `retention:cron:${ip}`, limit: 10, windowSeconds: 600 })
      if (!cronTokenValid(presented)) {
        await audit({
          action: 'retention.run',
          actorKind: 'system',
          actorLabel: 'planificateur',
          outcome: 'denied',
          detail: { reason: env().CRON_SECRET ? 'bad_token' : 'cron_disabled' },
          ip: context.ip,
          userAgent: context.userAgent,
        })
        return problem(401, 'Secret de planificateur invalide.', 'invalid_cron_token')
      }
      const report = await runRetention({ trigger: 'scheduler' })
      return json({ report })
    }

    const user = await currentUser()
    if (!user || !can(user.role, 'retention.run')) {
      // Même message dans les deux cas : ne pas révéler si le compte existe ni
      // si la purge planifiée est configurée.
      return problem(
        user ? 403 : 401,
        'Action réservée à un administrateur.',
        user ? 'forbidden' : 'unauthenticated',
      )
    }

    const report = await runRetention({
      trigger: 'admin',
      userId: user.id,
      label: user.displayName,
    })
    return json({ report })
  })
}
