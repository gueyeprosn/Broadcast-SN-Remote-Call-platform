/**
 * Calculs purs de la politique de conservation.
 *
 * Isolés de `server/services/retention.ts` pour deux raisons : ils sont
 * testables sans base de données ni variables d'environnement, et la règle
 * métier (« qu'est-ce qui est purgé, et au bout de combien de temps ») devient
 * lisible d'un seul coup d'œil.
 */

export const DAY_MS = 86_400_000

/** Une session « en direct » depuis plus longtemps est signalée comme oubliée. */
export const STALE_LIVE_MS = DAY_MS

export interface RetentionPolicy {
  /** Jours de conservation d'une session terminée. */
  sessionDays: number
  /**
   * Jours de conservation du journal d'audit, ou `null` si jamais purgé.
   * `null` est le défaut : supprimer la trace de qui a fait quoi doit être une
   * décision explicite, pas l'effet de bord d'une tâche de ménage.
   */
  auditDays: number | null
}

export function resolvePolicy(retentionDays: number, auditRetentionDays: number): RetentionPolicy {
  return {
    sessionDays: retentionDays,
    auditDays: auditRetentionDays > 0 ? auditRetentionDays : null,
  }
}

/** Date de purge d'une session terminée à `endedAt`. */
export function purgeAfter(policy: RetentionPolicy, endedAt: Date): Date {
  return new Date(endedAt.getTime() + policy.sessionDays * DAY_MS)
}

/** Limite d'ancienneté des données de session, relative à `now`. */
export function sessionCutoff(policy: RetentionPolicy, now: Date): Date {
  return new Date(now.getTime() - policy.sessionDays * DAY_MS)
}

/** Limite d'ancienneté du journal d'audit, ou `null` si aucune fenêtre. */
export function auditCutoff(policy: RetentionPolicy, now: Date): Date | null {
  if (policy.auditDays === null) return null
  return new Date(now.getTime() - policy.auditDays * DAY_MS)
}

/** Limite au-delà de laquelle une session « en direct » est jugée oubliée. */
export function staleLiveCutoff(now: Date): Date {
  return new Date(now.getTime() - STALE_LIVE_MS)
}
