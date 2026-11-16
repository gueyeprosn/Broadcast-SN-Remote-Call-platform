import { z } from 'zod'
import { db } from '@/lib/db'
import { QUALITY_PROFILES } from '@/lib/media/engine'
import { engine } from '@/lib/media/vdoninja'
import { requireParticipant, HttpError } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { markState } from '@/server/services/participant'
import { audit, requestContext } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

const schema = z.object({
  videoDeviceId: z.string().max(200).optional(),
  audioDeviceId: z.string().max(200).optional(),
  cameraEnabled: z.boolean().default(true),
  micEnabled: z.boolean().default(true),
})

/**
 * Entrée en salle du correspondant.
 *
 * L'URL du moteur est construite **ici, côté serveur**, et jamais dans le
 * navigateur. Si le client la composait, un correspondant pourrait y glisser
 * `&director=` et prendre la main sur la salle. Le secret de salle ne transite
 * donc que dans cette réponse, pour une session déjà authentifiée par cookie.
 */
export async function POST(request: Request) {
  return handle(async () => {
    const me = await requireParticipant()
    const body = await parseBody(request, schema)
    const context = requestContext(request.headers)

    const participant = await db.participant.findUniqueOrThrow({
      where: { id: me.id },
      include: {
        session: {
          select: {
            id: true,
            name: true,
            state: true,
            roomName: true,
            roomSecret: true,
            returnStreamId: true,
            production: { select: { name: true } },
          },
        },
      },
    })

    if (participant.session.state === 'ENDED') {
      throw new HttpError(410, 'La session est terminée.', 'session_ended')
    }

    const profile = QUALITY_PROFILES[participant.qualityProfile]
    const eng = engine()

    const publisherUrl = eng.publisherUrl({
      roomName: participant.session.roomName,
      roomSecret: participant.session.roomSecret,
      streamId: participant.streamId,
      label: participant.displayName,
      profile,
      videoDeviceId: body.videoDeviceId,
      audioDeviceId: body.audioDeviceId,
      // Les autorisations de la régie priment sur la demande du client.
      micEnabled: body.micEnabled && participant.micAllowed,
      cameraEnabled: body.cameraEnabled && participant.cameraAllowed,
    })

    const returnUrl = eng.returnViewerUrl({
      roomName: participant.session.roomName,
      roomSecret: participant.session.roomSecret,
      returnStreamId: participant.session.returnStreamId,
    })

    await db.mediaEndpoint.upsert({
      where: { participantId_kind: { participantId: participant.id, kind: 'PUBLISH' } },
      create: {
        participantId: participant.id,
        kind: 'PUBLISH',
        engineId: eng.id,
        // Les secrets ne sont pas conservés dans le gabarit journalisé.
        urlTemplate: publisherUrl.replace(participant.session.roomSecret, '<secret>'),
      },
      update: {
        urlTemplate: publisherUrl.replace(participant.session.roomSecret, '<secret>'),
      },
    })

    await markState(participant.id, 'CONNECTING')
    await db.connectionEvent.create({
      data: {
        sessionId: participant.sessionId,
        participantId: participant.id,
        type: 'JOIN_REQUESTED',
        payload: { cameraEnabled: body.cameraEnabled, micEnabled: body.micEnabled },
      },
    })
    await audit({
      action: 'participant.join',
      actorKind: 'participant',
      actorLabel: participant.displayName,
      target: participant.id,
      ip: context.ip,
      userAgent: context.userAgent,
    })

    return json({
      publisherUrl,
      returnUrl,
      engineOrigin: eng.origin,
      capabilities: eng.capabilities,
      profile,
      participant: {
        id: participant.id,
        displayName: participant.displayName,
        onAir: participant.onAir,
        micAllowed: participant.micAllowed,
        cameraAllowed: participant.cameraAllowed,
      },
      session: {
        id: participant.session.id,
        name: participant.session.name,
        productionName: participant.session.production.name,
        state: participant.session.state,
      },
    })
  })
}
