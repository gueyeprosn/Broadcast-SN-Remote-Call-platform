import { z } from 'zod'
import { db } from '@/lib/db'
import { engine } from '@/lib/media/vdoninja'
import { requireCapability, HttpError } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { audit } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

const schema = z.object({
  audioDeviceId: z.string().max(200).optional(),
  videoDeviceId: z.string().max(200).optional(),
  audioOnly: z.boolean().default(true),
})

/**
 * Construit l'URL de publication du retour programme.
 *
 * Comme pour les correspondants, l'URL est assemblée côté serveur : elle contient
 * le secret de salle, et la composer dans le navigateur permettrait d'y glisser
 * d'autres paramètres.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('control.returnbus')
    const { id } = await context.params
    const body = await parseBody(request, schema)

    const session = await db.session.findUnique({
      where: { id },
      select: {
        id: true,
        state: true,
        roomName: true,
        roomSecret: true,
        returnStreamId: true,
        production: { select: { ownerId: true } },
      },
    })
    if (!session) throw new HttpError(404, 'Session introuvable.')
    if (user.role === 'DIRECTOR' && session.production.ownerId !== user.id) {
      throw new HttpError(403, 'Session non accessible.')
    }
    if (session.state === 'ENDED') throw new HttpError(409, 'Session terminée.')

    const url = engine().returnPublisherUrl({
      roomName: session.roomName,
      roomSecret: session.roomSecret,
      returnStreamId: session.returnStreamId,
      audioOnly: body.audioOnly,
      audioDeviceId: body.audioDeviceId,
      videoDeviceId: body.videoDeviceId,
    })

    await audit({
      action: 'return.publish',
      actorId: user.id,
      actorLabel: user.displayName,
      target: session.id,
      detail: { audioOnly: body.audioOnly },
    })

    return json({ url, returnStreamId: session.returnStreamId })
  })
}
