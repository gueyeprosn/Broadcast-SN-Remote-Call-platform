import { z } from 'zod'
import { db } from '@/lib/db'
import { createUserSession } from '@/server/auth/session'
import { verifyPassword } from '@/server/auth/password'
import { handle, json, parseBody, problem } from '@/server/http'
import { audit, requestContext } from '@/server/services/audit'
import { clientIp, enforce } from '@/server/services/ratelimit'

export const dynamic = 'force-dynamic'

const schema = z.object({
  email: z.string().email().max(200),
  password: z.string().min(1).max(200),
})

/** Verrouillage progressif du compte après échecs répétés. */
const MAX_FAILED = 8
const LOCK_MINUTES = 15

export async function POST(request: Request) {
  return handle(async () => {
    const ip = clientIp(request.headers)
    const context = requestContext(request.headers)

    // Deux compartiments : par IP (contre le balayage) et par compte (contre le
    // bourrage de mots de passe sur une cible nommée).
    await enforce({ key: `login:ip:${ip}`, limit: 20, windowSeconds: 300 })

    const body = await parseBody(request, schema)
    const email = body.email.trim().toLowerCase()
    await enforce({ key: `login:acct:${email}`, limit: 10, windowSeconds: 300 })

    const user = await db.user.findUnique({ where: { email } })

    // Message unique quelle que soit la cause : compte inexistant, mot de passe
    // faux ou compte désactivé. Ne pas révéler quels comptes existent.
    const generic = () =>
      problem(401, 'Identifiants invalides ou compte indisponible.', 'invalid_credentials')

    if (!user || !user.isActive) {
      await audit({
        action: 'auth.login',
        actorKind: 'system',
        actorLabel: email,
        outcome: 'denied',
        detail: { reason: user ? 'inactive' : 'unknown_account' },
        ip: context.ip,
        userAgent: context.userAgent,
      })
      return generic()
    }

    if (user.lockedUntil && user.lockedUntil > new Date()) {
      await audit({
        action: 'auth.login',
        actorId: user.id,
        outcome: 'denied',
        detail: { reason: 'locked' },
        ip: context.ip,
        userAgent: context.userAgent,
      })
      return problem(
        423,
        'Compte temporairement verrouillé après plusieurs échecs. Réessayez plus tard.',
        'account_locked',
      )
    }

    const ok = await verifyPassword(body.password, user.passwordHash)
    if (!ok) {
      const failed = user.failedLogins + 1
      await db.user.update({
        where: { id: user.id },
        data: {
          failedLogins: failed,
          lockedUntil:
            failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null,
        },
      })
      await audit({
        action: 'auth.login',
        actorId: user.id,
        outcome: 'denied',
        detail: { reason: 'bad_password', failedLogins: failed },
        ip: context.ip,
        userAgent: context.userAgent,
      })
      return generic()
    }

    await db.user.update({
      where: { id: user.id },
      data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() },
    })
    await createUserSession(user.id, user.role, user.tokenEpoch)
    await audit({
      action: 'auth.login',
      actorId: user.id,
      actorLabel: user.displayName,
      outcome: 'ok',
      ip: context.ip,
      userAgent: context.userAgent,
    })

    return json({
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role,
      },
    })
  })
}
