import { z } from 'zod'
import { db } from '@/lib/db'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { publish, sessionTopic } from '@/server/events/bus'
import { audit } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

const schema = z.object({ text: z.string().min(1).max(280) })

/**
 * Message du réalisateur à un correspondant.
 *
 * Passe par le bus applicatif (SSE) et non par le chat du moteur média : le
 * message est ainsi journalisé, horodaté, et restitué même si le correspondant
 * recharge sa page. La console peut en plus l'envoyer par `sendDirectorChat`
 * pour qu'il s'affiche dans l'iframe — les deux chemins sont complémentaires.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('control.message')
    const { id } = await context.params
    const body = await parseBody(request, schema)

    const participant = await db.participant.findUnique({
      where: { id },
      select: {
        id: true,
        sessionId: true,
        session: { select: { production: { select: { ownerId: true } } } },
      },
    })
    if (!participant) {
      return json({ error: { code: 'not_found', message: 'Correspondant introuvable.' } }, 404)
    }
    if (user.role === 'DIRECTOR' && participant.session.production.ownerId !== user.id) {
      return json({ error: { code: 'forbidden', message: 'Non autorisé.' } }, 403)
    }

    const at = new Date()
    await db.connectionEvent.create({
      data: {
        sessionId: participant.sessionId,
        participantId: participant.id,
        type: 'MESSAGE_SENT',
        message: body.text,
      },
    })
    publish(sessionTopic(participant.sessionId), {
      type: 'director.message',
      participantId: participant.id,
      text: body.text,
      at: at.toISOString(),
    })
    await audit({
      action: 'control.message',
      actorId: user.id,
      actorLabel: user.displayName,
      target: participant.id,
      detail: { length: body.text.length },
    })
    return json({ ok: true, at: at.toISOString() })
  })
}
