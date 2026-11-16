import { db } from '@/lib/db'
import { hashToken, newInviteToken } from '@/lib/ids'
import { HttpError, type AuthedUser } from '@/server/auth/guard'
import { audit } from './audit'

export const DEFAULT_TTL_MINUTES = 12 * 60
export const MAX_TTL_MINUTES = 7 * 24 * 60
export const DEFAULT_MAX_USES = 5

export interface CreatedInvitation {
  id: string
  /** Jeton en clair. Affiché UNE SEULE FOIS — il n'est pas stocké. */
  token: string
  url: string
  expiresAt: Date
  maxUses: number
}

export async function createInvitation(
  user: AuthedUser,
  input: { participantId: string; ttlMinutes?: number; maxUses?: number },
  appUrl: string,
): Promise<CreatedInvitation> {
  const participant = await db.participant.findUnique({
    where: { id: input.participantId },
    include: {
      session: {
        select: { id: true, state: true, production: { select: { ownerId: true } } },
      },
    },
  })
  if (!participant) throw new HttpError(404, 'Correspondant introuvable.')
  if (participant.state === 'REVOKED') {
    throw new HttpError(409, 'Correspondant révoqué : réactivez-le avant de réinviter.')
  }
  if (participant.session.state === 'ENDED') throw new HttpError(409, 'Session terminée.')
  if (user.role === 'DIRECTOR' && participant.session.production.ownerId !== user.id) {
    throw new HttpError(403, 'Correspondant non accessible.')
  }

  const ttl = Math.min(
    Math.max(input.ttlMinutes ?? DEFAULT_TTL_MINUTES, 5),
    MAX_TTL_MINUTES,
  )
  const maxUses = Math.min(Math.max(input.maxUses ?? DEFAULT_MAX_USES, 1), 50)

  const token = newInviteToken()
  const expiresAt = new Date(Date.now() + ttl * 60_000)

  const invitation = await db.invitation.create({
    data: {
      sessionId: participant.sessionId,
      participantId: participant.id,
      // Seule l'empreinte est stockée : un vol de base ne permet pas de rejoindre.
      tokenHash: hashToken(token),
      tokenHint: token.slice(0, 8),
      expiresAt,
      maxUses,
      createdById: user.id,
    },
  })

  await db.participant.update({
    where: { id: participant.id },
    data: { state: participant.state === 'INVITED' ? 'INVITED' : participant.state },
  })

  await audit({
    action: 'invitation.create',
    actorId: user.id,
    actorLabel: user.displayName,
    target: invitation.id,
    detail: { participantId: participant.id, ttlMinutes: ttl, maxUses },
  })

  return {
    id: invitation.id,
    token,
    url: `${appUrl.replace(/\/+$/, '')}/join/${token}`,
    expiresAt,
    maxUses,
  }
}

export async function revokeInvitation(user: AuthedUser, invitationId: string) {
  const invitation = await db.invitation.findUnique({
    where: { id: invitationId },
    include: { session: { select: { production: { select: { ownerId: true } } } } },
  })
  if (!invitation) throw new HttpError(404, 'Invitation introuvable.')
  if (user.role === 'DIRECTOR' && invitation.session.production.ownerId !== user.id) {
    throw new HttpError(403, 'Invitation non accessible.')
  }
  if (invitation.revokedAt) return invitation

  const updated = await db.invitation.update({
    where: { id: invitationId },
    data: { revokedAt: new Date() },
  })
  await audit({
    action: 'invitation.revoke',
    actorId: user.id,
    actorLabel: user.displayName,
    target: invitationId,
  })
  return updated
}

export type ResolveFailure =
  | 'not_found'
  | 'revoked'
  | 'expired'
  | 'exhausted'
  | 'session_ended'
  | 'participant_revoked'

export interface ResolveOk {
  ok: true
  invitation: { id: string; expiresAt: Date }
  participant: { id: string; displayName: string; qualityProfile: string }
  session: { id: string; name: string; tokenEpoch: number; productionName: string }
  /** Durée restante en secondes, pour caler le cookie du participant. */
  ttlSeconds: number
}

export interface ResolveErr {
  ok: false
  reason: ResolveFailure
}

/**
 * Résout un jeton d'invitation.
 *
 * Les motifs d'échec sont **distincts** : un correspondant qui appelle la régie
 * pendant un direct doit pouvoir dire « ça me dit expiré » plutôt que « ça marche
 * pas ». Ces motifs ne révèlent rien d'exploitable : sans jeton valide, aucun
 * d'entre eux n'est atteignable.
 */
export async function resolveInvitation(token: string): Promise<ResolveOk | ResolveErr> {
  if (!token || token.length < 16) return { ok: false, reason: 'not_found' }

  const invitation = await db.invitation.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      participant: { select: { id: true, displayName: true, qualityProfile: true, state: true } },
      session: {
        select: {
          id: true,
          name: true,
          state: true,
          tokenEpoch: true,
          production: { select: { name: true } },
        },
      },
    },
  })
  if (!invitation) return { ok: false, reason: 'not_found' }
  if (invitation.revokedAt) return { ok: false, reason: 'revoked' }
  if (invitation.expiresAt <= new Date()) return { ok: false, reason: 'expired' }
  if (invitation.usedCount >= invitation.maxUses) return { ok: false, reason: 'exhausted' }
  if (invitation.session.state === 'ENDED') return { ok: false, reason: 'session_ended' }
  if (invitation.participant.state === 'REVOKED') {
    return { ok: false, reason: 'participant_revoked' }
  }

  return {
    ok: true,
    invitation: { id: invitation.id, expiresAt: invitation.expiresAt },
    participant: {
      id: invitation.participant.id,
      displayName: invitation.participant.displayName,
      qualityProfile: invitation.participant.qualityProfile,
    },
    session: {
      id: invitation.session.id,
      name: invitation.session.name,
      tokenEpoch: invitation.session.tokenEpoch,
      productionName: invitation.session.production.name,
    },
    ttlSeconds: Math.max(
      60,
      Math.floor((invitation.expiresAt.getTime() - Date.now()) / 1000),
    ),
  }
}

/** Consomme un usage. Atomique : deux ouvertures simultanées ne partagent pas un crédit. */
export async function consumeInvitationUse(
  invitationId: string,
  ip: string | null,
): Promise<boolean> {
  const { count } = await db.invitation.updateMany({
    where: { id: invitationId, revokedAt: null, expiresAt: { gt: new Date() } },
    data: { usedCount: { increment: 1 }, lastUsedAt: new Date(), lastUsedIp: ip },
  })
  return count === 1
}

export const FAILURE_MESSAGES: Record<ResolveFailure, string> = {
  not_found: "Ce lien d'accès n'existe pas. Vérifiez qu'il a été copié en entier.",
  revoked: "Ce lien a été révoqué par la régie. Demandez-en un nouveau.",
  expired: "Ce lien a expiré. Demandez un nouveau lien à la régie.",
  exhausted: "Ce lien a atteint son nombre maximal d'utilisations.",
  session_ended: 'Cette émission est terminée.',
  participant_revoked: "Votre accès a été révoqué par la régie.",
}
