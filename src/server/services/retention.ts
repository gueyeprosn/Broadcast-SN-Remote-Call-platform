import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { log } from '@/lib/logger'
import {
  auditCutoff,
  purgeAfter,
  resolvePolicy,
  sessionCutoff,
  staleLiveCutoff,
  type RetentionPolicy,
} from '@/lib/retention-policy'
import { audit } from './audit'
import { purgeExpired as purgeExpiredRateLimits } from './ratelimit'

export type { RetentionPolicy }

/**
 * Politique de conservation.
 *
 * Rappel du cadre : **aucun média n'est jamais stocké.** Ce qui est conservé,
 * puis purgé ici, ce sont les métadonnées de production (sessions,
 * correspondants, invitations, événements de connexion, mappings vMix).
 *
 * Les calculs eux-mêmes vivent dans `lib/retention-policy.ts`, testables sans
 * base de données.
 */
export function retentionPolicy(): RetentionPolicy {
  const { RETENTION_DAYS, AUDIT_RETENTION_DAYS } = env()
  return resolvePolicy(RETENTION_DAYS, AUDIT_RETENTION_DAYS)
}

/** Date de purge d'une session qui vient de se terminer. */
export function purgeAfterFor(endedAt: Date = new Date()): Date {
  return purgeAfter(retentionPolicy(), endedAt)
}

// ── État ──────────────────────────────────────────────────────────────────────

export interface RetentionStatus {
  policy: RetentionPolicy
  /** Sessions terminées dont la date de purge est dépassée : seront supprimées. */
  sessionsDue: number
  /** Sessions terminées en attente, dont la date de purge est à venir. */
  sessionsPending: number
  /** Date de purge la plus proche parmi les sessions en attente. */
  nextPurgeAt: string | null
  /**
   * Sessions terminées **sans** date de purge : terminées avant la mise en place
   * de la politique, ou par un chemin qui ne l'a pas posée. La purge les répare.
   */
  sessionsMissingPurgeDate: number
  /** Événements de connexion anciens appartenant à une session encore ouverte. */
  staleConnectionEvents: number
  /** Compteurs de limitation de débit dont la fenêtre est expirée. */
  expiredRateLimits: number
  /** Lignes du journal d'audit hors fenêtre, si une fenêtre est définie. */
  auditRowsOutsideWindow: number
  /** Total du journal d'audit, pour mesurer sa croissance. */
  auditRowsTotal: number
  /**
   * Sessions planifiées jamais démarrées et plus anciennes que la fenêtre.
   * **Signalées, jamais supprimées** : seul un humain sait si elles comptent.
   */
  abandonedScheduledSessions: number
  /**
   * Sessions restées « en direct » au-delà de 24 h : un « Terminer » oublié.
   * Signalées, jamais supprimées — une session réellement en cours existe.
   */
  staleLiveSessions: number
}

export async function retentionStatus(): Promise<RetentionStatus> {
  const policy = retentionPolicy()
  const now = new Date()
  const sessionLimit = sessionCutoff(policy, now)
  const auditLimit = auditCutoff(policy, now)
  const liveLimit = staleLiveCutoff(now)

  const [
    sessionsDue,
    sessionsPending,
    nextPending,
    sessionsMissingPurgeDate,
    staleConnectionEvents,
    expiredRateLimits,
    auditRowsTotal,
    auditRowsOutsideWindow,
    abandonedScheduledSessions,
    staleLiveSessions,
  ] = await Promise.all([
    db.session.count({ where: { state: 'ENDED', purgeAfter: { lte: now } } }),
    db.session.count({ where: { state: 'ENDED', purgeAfter: { gt: now } } }),
    db.session.findFirst({
      where: { state: 'ENDED', purgeAfter: { gt: now } },
      orderBy: { purgeAfter: 'asc' },
      select: { purgeAfter: true },
    }),
    db.session.count({ where: { state: 'ENDED', purgeAfter: null } }),
    db.connectionEvent.count({
      where: { createdAt: { lt: sessionLimit }, session: { state: { not: 'ENDED' } } },
    }),
    db.rateLimit.count({ where: { windowEnd: { lte: now } } }),
    db.auditLog.count(),
    auditLimit
      ? db.auditLog.count({ where: { createdAt: { lt: auditLimit } } })
      : Promise.resolve(0),
    db.session.count({ where: { state: 'SCHEDULED', createdAt: { lt: sessionLimit } } }),
    db.session.count({ where: { state: 'LIVE', startedAt: { lt: liveLimit } } }),
  ])

  return {
    policy,
    sessionsDue,
    sessionsPending,
    nextPurgeAt: nextPending?.purgeAfter?.toISOString() ?? null,
    sessionsMissingPurgeDate,
    staleConnectionEvents,
    expiredRateLimits,
    auditRowsOutsideWindow,
    auditRowsTotal,
    abandonedScheduledSessions,
    staleLiveSessions,
  }
}

// ── Exécution ─────────────────────────────────────────────────────────────────

export interface RetentionReport {
  startedAt: string
  durationMs: number
  policy: RetentionPolicy
  /** Dates de purge réparées sur des sessions terminées qui en manquaient. */
  repairedPurgeDates: number
  /** Sessions supprimées, avec tout ce qui en dépend (cascade). */
  deletedSessions: number
  /** Événements anciens de sessions encore ouvertes. */
  deletedConnectionEvents: number
  deletedRateLimits: number
  /** Lignes d'audit supprimées. `0` si aucune fenêtre n'est définie. */
  deletedAuditRows: number
  /** Signalements, sans suppression. */
  flagged: { abandonedScheduledSessions: number; staleLiveSessions: number }
}

export type RetentionTrigger = 'admin' | 'scheduler'

export interface RetentionActor {
  trigger: RetentionTrigger
  userId?: string | null
  label?: string | null
}

/**
 * Exécute la purge.
 *
 * Ordre choisi avec soin :
 *  1. réparer les dates de purge manquantes, **avant** de sélectionner les
 *     sessions dues — sinon une session terminée sans date ne serait jamais
 *     purgée, ce qui est exactement le défaut que cette tâche corrige ;
 *  2. supprimer les sessions dues (la cascade emporte participants,
 *     invitations, événements, endpoints et mappings vMix) ;
 *  3. supprimer les événements anciens des sessions **encore ouvertes**, que la
 *     cascade ne touche pas ;
 *  4. purger les compteurs de limitation de débit expirés ;
 *  5. le journal d'audit **seulement** si une fenêtre est explicitement définie.
 *
 * Une réparation de date ne provoque pas de suppression au même passage : la
 * session attendra sa date. C'est volontaire — une session terminée hier et
 * dépourvue de date ne doit pas disparaître à cause d'une tâche de ménage.
 *
 * L'exécution est journalisée dans l'audit, y compris quand elle ne supprime
 * rien : savoir que la tâche tourne vaut autant que savoir ce qu'elle a fait.
 */
export async function runRetention(actor: RetentionActor): Promise<RetentionReport> {
  const startedAt = new Date()
  const policy = retentionPolicy()
  const sessionLimit = sessionCutoff(policy, startedAt)

  // 1. Réparation des dates manquantes.
  const orphans = await db.session.findMany({
    where: { state: 'ENDED', purgeAfter: null },
    select: { id: true, endedAt: true },
  })
  for (const orphan of orphans) {
    await db.session.update({
      where: { id: orphan.id },
      data: { purgeAfter: purgeAfter(policy, orphan.endedAt ?? startedAt) },
    })
  }

  // 2. Sessions dues. La cascade emporte tout ce qui en dépend.
  const { count: deletedSessions } = await db.session.deleteMany({
    where: { state: 'ENDED', purgeAfter: { lte: startedAt } },
  })

  // 3. Événements anciens des sessions encore ouvertes.
  const { count: deletedConnectionEvents } = await db.connectionEvent.deleteMany({
    where: { createdAt: { lt: sessionLimit }, session: { state: { not: 'ENDED' } } },
  })

  // 4. Compteurs de limitation de débit.
  const deletedRateLimits = await purgeExpiredRateLimits()

  // 5. Journal d'audit — uniquement sur fenêtre explicite.
  let deletedAuditRows = 0
  const auditLimit = auditCutoff(policy, startedAt)
  if (auditLimit) {
    const { count } = await db.auditLog.deleteMany({ where: { createdAt: { lt: auditLimit } } })
    deletedAuditRows = count
  }

  const [abandonedScheduledSessions, staleLiveSessions] = await Promise.all([
    db.session.count({ where: { state: 'SCHEDULED', createdAt: { lt: sessionLimit } } }),
    db.session.count({ where: { state: 'LIVE', startedAt: { lt: staleLiveCutoff(startedAt) } } }),
  ])

  const report: RetentionReport = {
    startedAt: startedAt.toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    policy,
    repairedPurgeDates: orphans.length,
    deletedSessions,
    deletedConnectionEvents,
    deletedRateLimits,
    deletedAuditRows,
    flagged: { abandonedScheduledSessions, staleLiveSessions },
  }

  log.info('retention.run', { trigger: actor.trigger, ...report })
  // Détail aplati pour la colonne JSON : `auditDays` vaut `null` dans la
  // politique, ce qu'une valeur JSON de Prisma n'accepte pas. On l'écrit en
  // clair (« jamais »), ce qui est de toute façon plus lisible dans le journal.
  await audit({
    action: 'retention.run',
    actorId: actor.userId ?? null,
    actorKind: actor.trigger === 'admin' ? 'user' : 'system',
    actorLabel: actor.label ?? (actor.trigger === 'scheduler' ? 'planificateur' : null),
    detail: {
      trigger: actor.trigger,
      startedAt: report.startedAt,
      durationMs: report.durationMs,
      sessionDays: policy.sessionDays,
      auditWindowDays: policy.auditDays ?? 'jamais',
      repairedPurgeDates: report.repairedPurgeDates,
      deletedSessions: report.deletedSessions,
      deletedConnectionEvents: report.deletedConnectionEvents,
      deletedRateLimits: report.deletedRateLimits,
      deletedAuditRows: report.deletedAuditRows,
      abandonedScheduledSessions,
      staleLiveSessions,
    },
  })

  return report
}
