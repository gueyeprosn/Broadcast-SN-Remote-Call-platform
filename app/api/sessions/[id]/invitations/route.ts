import { z } from 'zod'
import { env } from '@/lib/env'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { createInvitation } from '@/server/services/invitation'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const schema = z.object({
  participantId: z.string().min(1),
  ttlMinutes: z.number().int().min(5).max(7 * 24 * 60).optional(),
  maxUses: z.number().int().min(1).max(50).optional(),
})

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireCapability('participant.read')
    const { id } = await context.params
    const invitations = await db.invitation.findMany({
      where: { sessionId: id },
      orderBy: { createdAt: 'desc' },
      // Le jeton n'est jamais renvoyé : il n'est pas stocké en clair.
      select: {
        id: true,
        participantId: true,
        tokenHint: true,
        expiresAt: true,
        maxUses: true,
        usedCount: true,
        revokedAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    })
    return json({ invitations })
  })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('invitation.create')
    const { id } = await context.params
    const body = await parseBody(request, schema)

    const participant = await db.participant.findUnique({
      where: { id: body.participantId },
      select: { sessionId: true },
    })
    if (participant?.sessionId !== id) {
      return json(
        { error: { code: 'mismatch', message: 'Ce correspondant n’appartient pas à cette session.' } },
        400,
      )
    }

    const created = await createInvitation(user, body, env().APP_URL)
    // `token` et `url` ne transitent qu'ici, une seule fois.
    return json({ invitation: created }, 201)
  })
}
