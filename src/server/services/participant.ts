import { db } from '@/lib/db'
import { newOutputKey, newStreamId } from '@/lib/ids'
import { QUALITY_PROFILES } from '@/lib/media/engine'
import { engine } from '@/lib/media/vdoninja'
import { HttpError, type AuthedUser } from '@/server/auth/guard'
import { publish, sessionTopic } from '@/server/events/bus'
import { audit } from './audit'
import type { ParticipantRole, QualityProfile } from '@/generated/prisma/enums'
import type { Prisma } from '@/generated/prisma/client'

export async function addParticipant(
  user: AuthedUser,
  sessionId: string,
  input: { displayName: string; role?: ParticipantRole; qualityProfile?: QualityProfile },
) {
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      state: true,
      production: { select: { ownerId: true, defaultQualityProfile: true } },
    },
  })
  if (!session) throw new HttpError(404, 'Session introuvable.')
  if (session.state === 'ENDED') throw new HttpError(409, 'Session terminée.')
  if (user.role === 'DIRECTOR' && session.production.ownerId !== user.id) {
    throw new HttpError(403, 'Session non accessible.')
  }

  const displayName = input.displayName.trim()
  if (displayName.length < 2) throw new HttpError(400, 'Le nom du correspondant est trop court.')
  if (displayName.length > 60) throw new HttpError(400, 'Le nom du correspondant est trop long.')

  const participant = await db.participant.create({
    data: {
      sessionId,
      displayName,
      role: input.role ?? 'CORRESPONDENT',
      // IMMUABLE : garantit qu'une entrée vMix retrouve le bon correspondant
      // après un rafraîchissement de page.
      streamId: newStreamId(),
      outputKey: newOutputKey(),
      qualityProfile: input.qualityProfile ?? session.production.defaultQualityProfile,
    },
  })

  await audit({
    action: 'participant.create',
    actorId: user.id,
    actorLabel: user.displayName,
    target: participant.id,
    detail: { sessionId, displayName },
  })
  publish(sessionTopic(sessionId), {
    type: 'participant.state',
    participantId: participant.id,
    state: participant.state,
  })
  return participant
}

async function loadForDirector(user: AuthedUser, participantId: string) {
  const participant = await db.participant.findUnique({
    where: { id: participantId },
    include: {
      session: {
        select: {
          id: true,
          state: true,
          roomName: true,
          roomSecret: true,
          returnStreamId: true,
          production: { select: { ownerId: true } },
        },
      },
    },
  })
  if (!participant) throw new HttpError(404, 'Correspondant introuvable.')
  if (user.role === 'DIRECTOR' && participant.session.production.ownerId !== user.id) {
    throw new HttpError(403, 'Correspondant non accessible.')
  }
  return participant
}

export async function setOnAir(user: AuthedUser, participantId: string, onAir: boolean) {
  const participant = await loadForDirector(user, participantId)
  const updated = await db.participant.update({
    where: { id: participantId },
    data: { onAir, onAirSource: 'MANUAL' },
  })
  await db.connectionEvent.create({
    data: {
      sessionId: participant.sessionId,
      participantId,
      type: 'ON_AIR_CHANGED',
      message: onAir ? 'ON AIR' : 'STANDBY',
    },
  })
  publish(sessionTopic(participant.sessionId), {
    type: 'participant.onair',
    participantId,
    onAir,
    source: 'MANUAL',
  })
  await audit({
    action: 'participant.onair',
    actorId: user.id,
    actorLabel: user.displayName,
    target: participantId,
    detail: { onAir },
  })
  return updated
}

export async function setPermissions(
  user: AuthedUser,
  participantId: string,
  input: { micAllowed?: boolean; cameraAllowed?: boolean },
) {
  const participant = await loadForDirector(user, participantId)
  const updated = await db.participant.update({
    where: { id: participantId },
    data: {
      micAllowed: input.micAllowed ?? participant.micAllowed,
      cameraAllowed: input.cameraAllowed ?? participant.cameraAllowed,
    },
  })
  publish(sessionTopic(participant.sessionId), {
    type: 'participant.permissions',
    participantId,
    micAllowed: updated.micAllowed,
    cameraAllowed: updated.cameraAllowed,
  })
  await audit({
    action: 'participant.permissions',
    actorId: user.id,
    actorLabel: user.displayName,
    target: participantId,
    detail: { ...input },
  })
  return updated
}

export async function setQualityProfile(
  user: AuthedUser,
  participantId: string,
  profile: QualityProfile,
) {
  const participant = await loadForDirector(user, participantId)
  const updated = await db.participant.update({
    where: { id: participantId },
    data: { qualityProfile: profile },
  })
  await db.connectionEvent.create({
    data: {
      sessionId: participant.sessionId,
      participantId,
      type: 'QUALITY_CHANGED',
      message: QUALITY_PROFILES[profile].label,
    },
  })
  publish(sessionTopic(participant.sessionId), {
    type: 'participant.quality',
    participantId,
    profile,
  })
  return updated
}

export async function setReturnBus(
  user: AuthedUser,
  participantId: string,
  bus: string | null,
) {
  const participant = await loadForDirector(user, participantId)
  const normalized = bus?.trim().toUpperCase() || null
  if (normalized !== null && !['M', 'A', 'B', 'C', 'D', 'E', 'F', 'G'].includes(normalized)) {
    throw new HttpError(400, 'Bus de retour invalide. Attendu : M, A à G.')
  }
  const updated = await db.participant.update({
    where: { id: participantId },
    data: { returnBus: normalized },
  })
  publish(sessionTopic(participant.sessionId), {
    type: 'participant.returnbus',
    participantId,
    bus: normalized,
  })
  await audit({
    action: 'participant.returnbus',
    actorId: user.id,
    actorLabel: user.displayName,
    target: participantId,
    detail: { bus: normalized },
  })
  return updated
}

/**
 * Révoque l'accès d'un correspondant.
 *
 * Trois effets : état `REVOKED`, révocation de ses invitations, et — c'est le
 * point important — la révocation est effective **côté serveur** à la prochaine
 * requête du correspondant, parce que `requireParticipant()` relit son état.
 * Le raccrochage média est envoyé séparément par la console.
 */
export async function revokeParticipant(user: AuthedUser, participantId: string, reason: string) {
  const participant = await loadForDirector(user, participantId)
  await db.$transaction(async (tx) => {
    await tx.participant.update({
      where: { id: participantId },
      data: { state: 'REVOKED', onAir: false },
    })
    await tx.invitation.updateMany({
      where: { participantId, revokedAt: null },
      data: { revokedAt: new Date() },
    })
  })
  publish(sessionTopic(participant.sessionId), {
    type: 'participant.revoked',
    participantId,
    reason,
  })
  await audit({
    action: 'participant.revoke',
    actorId: user.id,
    actorLabel: user.displayName,
    target: participantId,
    detail: { reason },
  })
}

export async function recordMetrics(
  user: AuthedUser,
  participantId: string,
  metrics: Prisma.InputJsonValue,
) {
  const participant = await loadForDirector(user, participantId)
  await db.participant.update({
    where: { id: participantId },
    data: { lastMetrics: metrics, lastSeenAt: new Date() },
  })
  publish(sessionTopic(participant.sessionId), {
    type: 'participant.metrics',
    participantId,
    metrics,
  })
}

export async function markState(
  participantId: string,
  state: 'READY' | 'CONNECTING' | 'LIVE' | 'DISCONNECTED',
) {
  const participant = await db.participant.update({
    where: { id: participantId },
    data: { state, lastSeenAt: new Date() },
    select: { id: true, sessionId: true, state: true },
  })
  publish(sessionTopic(participant.sessionId), {
    type: 'participant.state',
    participantId,
    state,
  })
  return participant
}

/** URL de réception destinée à un Web Browser Input vMix (notre page de sortie). */
export function outputPageUrl(appUrl: string, outputKey: string): string {
  return `${appUrl.replace(/\/+$/, '')}/output/${outputKey}`
}

/** URL du moteur, utilisée seulement à l'intérieur de la page de sortie. */
export function receiverEngineUrl(input: {
  roomName: string
  roomSecret: string
  streamId: string
  qualityProfile: QualityProfile
}): string {
  return engine().receiverUrl({
    roomName: input.roomName,
    roomSecret: input.roomSecret,
    streamId: input.streamId,
    profile: QUALITY_PROFILES[input.qualityProfile],
  })
}
