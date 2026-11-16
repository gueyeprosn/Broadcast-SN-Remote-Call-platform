import { z } from 'zod'
import { db } from '@/lib/db'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody, problem } from '@/server/http'
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/server/auth/password'
import { audit } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

const schema = z.object({
  isActive: z.boolean().optional(),
  role: z.enum(['ADMIN', 'DIRECTOR', 'TECHNICIAN']).optional(),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200).optional(),
})

/**
 * Modifie un compte.
 *
 * Toute désactivation, tout changement de rôle et tout changement de mot de passe
 * incrémente `tokenEpoch`, ce qui invalide **immédiatement** les sessions
 * existantes de ce compte. Sans cela, un compte révoqué garderait l'accès
 * jusqu'à l'expiration de son cookie.
 */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const actor = await requireCapability('user.write')
    const { id } = await context.params
    const body = await parseBody(request, schema)

    const target = await db.user.findUnique({
      where: { id },
      select: { id: true, role: true, isActive: true },
    })
    if (!target) return problem(404, 'Compte introuvable.', 'not_found')

    // Garde-fou : ne pas se verrouiller hors de l'application.
    if (target.id === actor.id && (body.isActive === false || body.role === 'TECHNICIAN')) {
      return problem(
        409,
        'Vous ne pouvez pas retirer vos propres droits d’administration.',
        'self_lockout',
      )
    }

    // Changer SON mot de passe passe par /api/account/password, qui exige le mot
    // de passe actuel. Cette route-ci est une *réinitialisation* par un
    // administrateur sur le compte d'un tiers : elle ne doit pas offrir un
    // chemin plus faible pour son propre compte.
    if (target.id === actor.id && body.password !== undefined) {
      return problem(
        409,
        'Pour changer votre propre mot de passe, utilisez « Mon compte » : ' +
          'le mot de passe actuel y est exigé.',
        'use_account_route',
      )
    }
    if (target.role === 'ADMIN' && (body.isActive === false || (body.role && body.role !== 'ADMIN'))) {
      const remaining = await db.user.count({
        where: { role: 'ADMIN', isActive: true, id: { not: target.id } },
      })
      if (remaining === 0) {
        return problem(
          409,
          'Il doit rester au moins un administrateur actif.',
          'last_admin',
        )
      }
    }

    const data: Record<string, unknown> = { tokenEpoch: { increment: 1 } }
    if (body.isActive !== undefined) data['isActive'] = body.isActive
    if (body.role !== undefined) data['role'] = body.role
    if (body.password !== undefined) {
      data['passwordHash'] = await hashPassword(body.password)
      data['failedLogins'] = 0
      data['lockedUntil'] = null
    }

    await db.user.update({ where: { id }, data })
    await audit({
      action: 'user.update',
      actorId: actor.id,
      actorLabel: actor.displayName,
      target: id,
      detail: {
        isActive: body.isActive ?? null,
        role: body.role ?? null,
        passwordChanged: body.password !== undefined,
      },
    })
    return json({ ok: true })
  })
}
