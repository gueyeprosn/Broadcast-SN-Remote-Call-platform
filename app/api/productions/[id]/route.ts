import { z } from 'zod'
import { db } from '@/lib/db'
import { requireCapability, HttpError } from '@/server/auth/guard'
import { handle, json, parseBody, problem } from '@/server/http'
import { audit } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

async function loadForUser(userId: string, role: string, productionId: string) {
  const production = await db.production.findUnique({
    where: { id: productionId },
    select: {
      id: true,
      name: true,
      ownerId: true,
      isArchived: true,
      _count: { select: { sessions: true } },
    },
  })
  if (!production) throw new HttpError(404, 'Émission introuvable.')
  if (role === 'DIRECTOR' && production.ownerId !== userId) {
    throw new HttpError(403, 'Émission non accessible.')
  }
  return production
}

const patchSchema = z.object({ isArchived: z.boolean() })

/**
 * Archive ou désarchive une émission.
 *
 * L'archivage est réversible et conserve tout : sessions passées, journal
 * d'événements, mappings vMix. C'est l'opération de rangement. La suppression,
 * elle, est réservée aux émissions qui n'ont jamais servi (voir DELETE).
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('production.write')
    const { id } = await context.params
    const production = await loadForUser(user.id, user.role, id)
    const body = await parseBody(request, patchSchema)

    // Une émission qui porte une session en cours ne se range pas : elle
    // disparaîtrait de la liste alors qu'une antenne est ouverte dessus.
    if (body.isArchived) {
      const active = await db.session.count({
        where: { productionId: id, state: { in: ['LIVE', 'SCHEDULED'] } },
      })
      if (active > 0) {
        return problem(
          409,
          `« ${production.name} » porte ${active} édition(s) en cours ou préparée(s). ` +
            'Terminez-les avant de l’archiver.',
          'has_active_sessions',
        )
      }
    }

    await db.production.update({ where: { id }, data: { isArchived: body.isArchived } })
    await audit({
      action: body.isArchived ? 'production.archive' : 'production.unarchive',
      actorId: user.id,
      actorLabel: user.displayName,
      target: id,
      detail: { name: production.name },
    })
    return json({ ok: true })
  })
}

/**
 * Supprime une émission — uniquement si elle n'a **jamais** porté de session.
 *
 * C'est le cas « créée par erreur », et seulement celui-là. Dès qu'une édition
 * a existé, la suppression emporterait en cascade ses correspondants, ses
 * invitations et son journal d'événements : on archive à la place, ce que le
 * message de refus indique.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('production.write')
    const { id } = await context.params
    const production = await loadForUser(user.id, user.role, id)

    if (production._count.sessions > 0) {
      return problem(
        409,
        `« ${production.name} » compte ${production._count.sessions} édition(s). ` +
          'Supprimer emporterait leurs correspondants, invitations et journaux : ' +
          'archivez-la plutôt.',
        'has_sessions',
      )
    }

    await db.production.delete({ where: { id } })
    await audit({
      action: 'production.delete',
      actorId: user.id,
      actorLabel: user.displayName,
      target: id,
      detail: { name: production.name },
    })
    return json({ ok: true })
  })
}
