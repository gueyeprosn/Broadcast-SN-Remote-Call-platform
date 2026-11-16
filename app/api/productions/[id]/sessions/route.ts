import { z } from 'zod'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { createSession } from '@/server/services/session'

export const dynamic = 'force-dynamic'

const schema = z.object({
  name: z.string().min(2).max(120),
  scheduledAt: z.string().datetime().optional(),
})

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('session.write')
    const { id } = await context.params
    const body = await parseBody(request, schema)
    const session = await createSession(user, id, {
      name: body.name,
      scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null,
    })
    return json({ session }, 201)
  })
}
