import { z } from 'zod'
import { db } from '@/lib/db'
import { requireParticipant } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { markState } from '@/server/services/participant'
import { clearParticipantSession } from '@/server/auth/session'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => {
    const me = await requireParticipant()
    const participant = await db.participant.findUniqueOrThrow({
      where: { id: me.id },
      select: {
        id: true,
        displayName: true,
        state: true,
        onAir: true,
        onAirSource: true,
        micAllowed: true,
        cameraAllowed: true,
        qualityProfile: true,
        session: { select: { id: true, name: true, state: true } },
      },
    })
    return json({ participant })
  })
}

const schema = z.object({
  state: z.enum(['READY', 'CONNECTING', 'LIVE', 'DISCONNECTED']),
})

export async function POST(request: Request) {
  return handle(async () => {
    const me = await requireParticipant()
    const body = await parseBody(request, schema)
    await markState(me.id, body.state)
    if (body.state === 'DISCONNECTED') {
      await db.connectionEvent.create({
        data: {
          sessionId: me.sessionId,
          participantId: me.id,
          type: 'DISCONNECTED',
          message: 'Déconnexion demandée par le correspondant',
        },
      })
      await clearParticipantSession()
    }
    return json({ ok: true })
  })
}
