import { z } from 'zod'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { endSession, startSession } from '@/server/services/session'

export const dynamic = 'force-dynamic'

const schema = z.object({ action: z.enum(['start', 'end']) })

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params
    const body = await parseBody(request, schema)
    if (body.action === 'start') {
      const user = await requireCapability('session.write')
      return json({ session: await startSession(user, id) })
    }
    const user = await requireCapability('session.end')
    return json({ session: await endSession(user, id) })
  })
}
