import { z } from 'zod'
import { db } from '@/lib/db'
import { requireUser } from '@/server/auth/guard'
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '@/server/auth/password'
import { createUserSession } from '@/server/auth/session'
import { handle, json, parseBody, problem } from '@/server/http'
import { audit, requestContext } from '@/server/services/audit'
import { clientIp, enforce } from '@/server/services/ratelimit'

export const dynamic = 'force-dynamic'

const schema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
})

/**
 * Changement de son propre mot de passe.
 *
 * Aucune capacité n'est requise : être authentifié suffit. Tout le monde doit
 * pouvoir changer son mot de passe, y compris un technicien qui n'a accès à
 * aucun écran d'administration.
 *
 * Le mot de passe **actuel** est exigé. Sans cela, quelqu'un qui trouve un poste
 * laissé ouvert pourrait changer le mot de passe et verrouiller son titulaire
 * dehors. C'est la différence entre un *changement* (par l'intéressé, qui prouve
 * qu'il est bien lui) et une *réinitialisation* (par un administrateur sur le
 * compte d'un tiers, qui relève d'une autre route).
 */
export async function POST(request: Request) {
  return handle(async () => {
    const actor = await requireUser()
    const context = requestContext(request.headers)
    const ip = clientIp(request.headers)

    // Freine la recherche du mot de passe actuel par essais successifs depuis
    // une session déjà ouverte.
    await enforce({ key: `account:password:${actor.id}`, limit: 5, windowSeconds: 900 })
    await enforce({ key: `account:password:ip:${ip}`, limit: 15, windowSeconds: 900 })

    const body = await parseBody(request, schema)

    const user = await db.user.findUnique({
      where: { id: actor.id },
      select: { id: true, passwordHash: true, role: true, tokenEpoch: true },
    })
    if (!user) return problem(401, 'Session invalide.', 'unauthenticated')

    if (!(await verifyPassword(body.currentPassword, user.passwordHash))) {
      await audit({
        action: 'account.password.change',
        actorId: actor.id,
        actorLabel: actor.displayName,
        outcome: 'denied',
        detail: { reason: 'bad_current_password' },
        ip: context.ip,
        userAgent: context.userAgent,
      })
      return problem(400, 'Le mot de passe actuel est incorrect.', 'bad_current_password')
    }

    if (body.newPassword === body.currentPassword) {
      return problem(
        400,
        'Le nouveau mot de passe doit être différent de l’actuel.',
        'unchanged_password',
      )
    }

    // L'incrément de `tokenEpoch` invalide instantanément TOUTES les sessions de
    // ce compte, sur tous les appareils — c'est précisément ce qu'on veut après
    // un changement de mot de passe.
    const updated = await db.user.update({
      where: { id: actor.id },
      data: {
        passwordHash: await hashPassword(body.newPassword),
        tokenEpoch: { increment: 1 },
        failedLogins: 0,
        lockedUntil: null,
      },
      select: { tokenEpoch: true, role: true },
    })

    // ... y compris celle-ci. On en délivre donc une nouvelle, à jour, pour que
    // l'auteur du changement reste connecté là où il est, et seulement là.
    await createUserSession(actor.id, updated.role, updated.tokenEpoch)

    await audit({
      action: 'account.password.change',
      actorId: actor.id,
      actorLabel: actor.displayName,
      outcome: 'ok',
      ip: context.ip,
      userAgent: context.userAgent,
    })

    return json({
      ok: true,
      message:
        'Mot de passe modifié. Vos autres sessions ont été déconnectées.',
    })
  })
}
