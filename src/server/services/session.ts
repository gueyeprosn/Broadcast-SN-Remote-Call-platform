import { db } from '@/lib/db'
import { newReturnStreamId, newRoomName, newRoomSecret } from '@/lib/ids'
import { HttpError, type AuthedUser } from '@/server/auth/guard'
import { publish, sessionTopic } from '@/server/events/bus'
import { audit } from './audit'
import { purgeAfterFor } from './retention'

/**
 * La durée de conservation vient de la politique de rétention, pas d'une
 * constante locale : elle est configurable par déploiement et la tâche de purge
 * doit lire exactement la même valeur.
 */

export async function createSession(
  user: AuthedUser,
  productionId: string,
  input: { name: string; scheduledAt?: Date | null },
) {
  const production = await db.production.findUnique({
    where: { id: productionId },
    select: { id: true, ownerId: true, defaultQualityProfile: true },
  })
  if (!production) throw new HttpError(404, 'Production introuvable.')
  if (user.role !== 'ADMIN' && production.ownerId !== user.id) {
    throw new HttpError(403, 'Production non accessible.')
  }
  const name = input.name.trim()
  if (name.length < 2) throw new HttpError(400, 'Le nom de la session est trop court.')

  const session = await db.session.create({
    data: {
      productionId,
      name,
      // Le nom de salle est opaque : il circule dans les URL du moteur média et
      // ne doit rien révéler de l'émission.
      roomName: newRoomName(),
      roomSecret: newRoomSecret(),
      returnStreamId: newReturnStreamId(),
      scheduledAt: input.scheduledAt ?? null,
    },
  })
  await audit({
    action: 'session.create',
    actorId: user.id,
    actorLabel: user.displayName,
    target: session.id,
    detail: { productionId, name },
  })
  return session
}

export async function getSessionForConsole(user: AuthedUser, sessionId: string) {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    include: {
      production: { select: { id: true, name: true, ownerId: true, defaultQualityProfile: true } },
      participants: { orderBy: { createdAt: 'asc' } },
      mappings: {
        include: { connection: { select: { id: true, label: true, host: true, port: true, mode: true } } },
      },
    },
  })
  if (!session) throw new HttpError(404, 'Session introuvable.')
  if (user.role === 'DIRECTOR' && session.production.ownerId !== user.id) {
    throw new HttpError(403, 'Session non accessible.')
  }
  return session
}

export async function startSession(user: AuthedUser, sessionId: string) {
  const session = await getSessionForConsole(user, sessionId)
  if (session.state === 'ENDED') throw new HttpError(409, 'Session déjà terminée.')
  if (session.state === 'LIVE') return session

  const updated = await db.session.update({
    where: { id: sessionId },
    data: { state: 'LIVE', startedAt: new Date() },
  })
  publish(sessionTopic(sessionId), { type: 'session.state', sessionId, state: 'LIVE' })
  await audit({
    action: 'session.start',
    actorId: user.id,
    actorLabel: user.displayName,
    target: sessionId,
  })
  return updated
}

/**
 * Termine la session.
 *
 * Trois effets, tous nécessaires : état `ENDED`, révocation de toutes les
 * invitations, et rotation de `tokenEpoch` — qui invalide instantanément les
 * cookies de tous les correspondants, sans attendre leur expiration. Le
 * raccrochage média lui-même est envoyé par la console (elle seule tient le
 * canal director).
 */
export async function endSession(user: AuthedUser, sessionId: string) {
  const session = await getSessionForConsole(user, sessionId)
  if (session.state === 'ENDED') return session

  const updated = await db.$transaction(async (tx) => {
    const result = await tx.session.update({
      where: { id: sessionId },
      data: {
        state: 'ENDED',
        endedAt: new Date(),
        tokenEpoch: { increment: 1 },
        purgeAfter: purgeAfterFor(),
      },
    })
    await tx.invitation.updateMany({
      where: { sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
    await tx.participant.updateMany({
      where: { sessionId, state: { notIn: ['REVOKED'] } },
      data: { state: 'DISCONNECTED', onAir: false },
    })
    return result
  })

  publish(sessionTopic(sessionId), { type: 'session.state', sessionId, state: 'ENDED' })
  await audit({
    action: 'session.end',
    actorId: user.id,
    actorLabel: user.displayName,
    target: sessionId,
  })
  return updated
}

// La purge des sessions expirées vit dans `services/retention.ts`, avec le reste
// de la politique de conservation. Elle y fait plus que ce raccourci : elle
// répare d'abord les sessions terminées dépourvues de date de purge, qui sinon
// ne seraient jamais supprimées.
