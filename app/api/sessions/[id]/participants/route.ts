import { z } from 'zod'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { addParticipant } from '@/server/services/participant'

export const dynamic = 'force-dynamic'

const schema = z.object({
  displayName: z.string().min(2).max(60),
  role: z.enum(['CORRESPONDENT', 'GUEST', 'CONTRIBUTOR']).optional(),
  qualityProfile: z.enum(['ECONOMY', 'STANDARD', 'BROADCAST', 'HIGH']).optional(),
})

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('participant.write')
    const { id } = await context.params
    const body = await parseBody(request, schema)
    const participant = await addParticipant(user, id, body)
    return json({ participant }, 201)
  })
}
