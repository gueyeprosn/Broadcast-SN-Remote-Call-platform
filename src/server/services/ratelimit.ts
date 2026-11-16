import { db } from '@/lib/db'
import { HttpError } from '@/server/auth/guard'

export interface RateLimitRule {
  /** Identifiant du compartiment, p.ex. `login:ip:1.2.3.4`. */
  key: string
  /** Nombre d'actions autorisées dans la fenêtre. */
  limit: number
  /** Durée de la fenêtre en secondes. */
  windowSeconds: number
}

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfterSeconds: number
}

/**
 * Limitation de débit persistée en base.
 *
 * Un compteur en mémoire se remet à zéro à chaque redéploiement et ne vaut rien
 * derrière plusieurs instances. Ici le compteur survit au redémarrage.
 *
 * L'incrément est atomique : `updateMany` avec la fenêtre courante en condition,
 * puis création si aucune ligne n'a été touchée. Deux requêtes simultanées ne
 * peuvent donc pas se partager le même crédit.
 */
export async function consume(rule: RateLimitRule): Promise<RateLimitResult> {
  const now = new Date()
  const windowEnd = new Date(now.getTime() + rule.windowSeconds * 1000)

  const existing = await db.rateLimit.findUnique({ where: { key: rule.key } })

  if (!existing || existing.windowEnd <= now) {
    // Fenêtre absente ou expirée : on la (re)démarre à 1.
    await db.rateLimit.upsert({
      where: { key: rule.key },
      create: { key: rule.key, count: 1, windowEnd },
      update: { count: 1, windowEnd },
    })
    return { allowed: true, remaining: rule.limit - 1, retryAfterSeconds: 0 }
  }

  if (existing.count >= rule.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((existing.windowEnd.getTime() - now.getTime()) / 1000),
      ),
    }
  }

  const updated = await db.rateLimit.updateMany({
    where: { key: rule.key, windowEnd: existing.windowEnd },
    data: { count: { increment: 1 } },
  })
  if (updated.count === 0) {
    // Une autre requête a fait tourner la fenêtre entre-temps : on réessaie.
    return consume(rule)
  }
  return {
    allowed: true,
    remaining: Math.max(0, rule.limit - existing.count - 1),
    retryAfterSeconds: 0,
  }
}

export async function enforce(rule: RateLimitRule): Promise<void> {
  const result = await consume(rule)
  if (!result.allowed) {
    throw new HttpError(
      429,
      `Trop de tentatives. Réessayez dans ${result.retryAfterSeconds} s.`,
      'rate_limited',
    )
  }
}

/** Purge les fenêtres expirées. Appelé par la tâche de rétention. */
export async function purgeExpired(): Promise<number> {
  const { count } = await db.rateLimit.deleteMany({ where: { windowEnd: { lte: new Date() } } })
  return count
}

/**
 * Adresse cliente. Derrière Nginx on lit `X-Forwarded-For`, mais uniquement
 * sa première valeur — les suivantes sont contrôlables par le client.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return first
  }
  return headers.get('x-real-ip')?.trim() ?? 'unknown'
}
