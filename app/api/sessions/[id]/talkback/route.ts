import { z } from 'zod'
import { db } from '@/lib/db'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, problem } from '@/server/http'
import { parseBody } from '@/server/http'
import { publish, sessionTopic } from '@/server/events/bus'
import { audit } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

/**
 * État du talkback.
 *
 * Cette route ne transporte **pas** l'audio : le canal privé est ouvert par la
 * console via `soloChat` sur le canal director. Elle sert à :
 *
 *  1. garantir qu'un seul correspondant est en talkback à la fois — l'état est
 *     tenu côté serveur, donc deux opérateurs sur deux postes ne peuvent pas
 *     ouvrir deux canaux sans le savoir ;
 *  2. informer le correspondant qu'on lui parle en privé ;
 *  3. journaliser l'ouverture et la fermeture, parce qu'un talkback resté ouvert
 *     est un incident d'antenne.
 */
const openBySession = new Map<string, { participantId: string; at: number }>()

const schema = z.object({
  participantId: z.string().min(1).nullable(),
  open: z.boolean(),
  bidirectional: z.boolean().default(false),
})

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireCapability('control.talkback')
    const { id } = await context.params
    const current = openBySession.get(id) ?? null
    return json({ talkback: current })
  })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('control.talkback')
    const { id: sessionId } = await context.params
    const body = await parseBody(request, schema)

    if (!body.open) {
      const previous = openBySession.get(sessionId)
      openBySession.delete(sessionId)
      if (previous) {
        await db.connectionEvent.create({
          data: {
            sessionId,
            participantId: previous.participantId,
            type: 'TALKBACK_CLOSED',
            message: `Fermé après ${Math.round((Date.now() - previous.at) / 1000)} s`,
          },
        })
        publish(sessionTopic(sessionId), {
          type: 'talkback.state',
          participantId: previous.participantId,
          open: false,
        })
      }
      await audit({
        action: 'control.talkback.close',
        actorId: user.id,
        actorLabel: user.displayName,
        target: previous?.participantId ?? sessionId,
      })
      return json({ talkback: null })
    }

    if (!body.participantId) {
      return problem(400, 'Un correspondant doit être désigné pour ouvrir le talkback.')
    }

    const participant = await db.participant.findUnique({
      where: { id: body.participantId },
      select: { id: true, sessionId: true, displayName: true, state: true },
    })
    if (!participant || participant.sessionId !== sessionId) {
      return problem(404, 'Correspondant introuvable dans cette session.')
    }
    if (participant.state === 'REVOKED') {
      return problem(409, 'Correspondant révoqué.')
    }

    // Un seul talkback à la fois : on ferme le précédent avant d'ouvrir.
    const previous = openBySession.get(sessionId)
    if (previous && previous.participantId !== participant.id) {
      publish(sessionTopic(sessionId), {
        type: 'talkback.state',
        participantId: previous.participantId,
        open: false,
      })
    }

    openBySession.set(sessionId, { participantId: participant.id, at: Date.now() })
    await db.connectionEvent.create({
      data: {
        sessionId,
        participantId: participant.id,
        type: 'TALKBACK_OPENED',
        message: body.bidirectional ? 'Bidirectionnel' : 'Unidirectionnel',
      },
    })
    publish(sessionTopic(sessionId), {
      type: 'talkback.state',
      participantId: participant.id,
      open: true,
    })
    await audit({
      action: 'control.talkback.open',
      actorId: user.id,
      actorLabel: user.displayName,
      target: participant.id,
      detail: { bidirectional: body.bidirectional, closedPrevious: previous?.participantId ?? null },
    })

    return json({
      talkback: { participantId: participant.id, bidirectional: body.bidirectional },
      closedPrevious: previous?.participantId ?? null,
    })
  })
}
