import { db } from '@/lib/db'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, problem } from '@/server/http'
import { audit } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

/**
 * Supprime une connexion vMix.
 *
 * Une connexion ne contient aucune donnée de production : une adresse, un mode
 * et des drapeaux. Ses associations correspondant → entrée disparaissent avec
 * elle (cascade), ce qui est correct — elles ne désignent plus rien.
 *
 * Refusé tant qu'une session **en cours ou préparée** s'appuie dessus : couper
 * le pilotage de vMix pendant un direct, parce que quelqu'un fait du ménage
 * dans un autre onglet, n'est pas acceptable.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('vmix.manage')
    const { id } = await context.params

    const connection = await db.vmixConnection.findUnique({
      where: { id },
      select: { id: true, label: true, host: true, port: true },
    })
    if (!connection) return problem(404, 'Connexion vMix introuvable.', 'not_found')

    const inUse = await db.vmixInputMapping.count({
      where: { connectionId: id, session: { state: { in: ['LIVE', 'SCHEDULED'] } } },
    })
    if (inUse > 0) {
      return problem(
        409,
        `« ${connection.label} » est utilisée par ${inUse} correspondant(s) ` +
          "d'une édition en cours ou préparée. Retirez ces associations d'abord.",
        'connection_in_use',
      )
    }

    const { count: mappings } = await db.vmixInputMapping.deleteMany({
      where: { connectionId: id },
    })
    await db.vmixConnection.delete({ where: { id } })

    await audit({
      action: 'vmix.connection.delete',
      actorId: user.id,
      actorLabel: user.displayName,
      target: id,
      detail: {
        label: connection.label,
        host: `${connection.host}:${connection.port}`,
        mappingsSupprimes: mappings,
      },
    })
    return json({ ok: true, mappingsSupprimes: mappings })
  })
}
