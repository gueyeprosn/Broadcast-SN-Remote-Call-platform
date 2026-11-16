import { z } from 'zod'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { recordMetrics } from '@/server/services/participant'

export const dynamic = 'force-dynamic'

/**
 * Mesures remontées par la console.
 *
 * `null` est une valeur légitime et signifie « non mesuré ». Elle est conservée
 * telle quelle : l'interface affiche alors « — », jamais « 0 ».
 */
const schema = z.object({
  resolution: z.string().max(20).nullable(),
  framerate: z.number().finite().nullable(),
  videoKbps: z.number().finite().nullable(),
  audioKbps: z.number().finite().nullable(),
  packetLossPct: z.number().finite().nullable(),
  rttMs: z.number().finite().nullable(),
  jitterMs: z.number().finite().nullable(),
  measuredAt: z.string().datetime().optional(),
})

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('metrics.read')
    const { id } = await context.params
    const body = await parseBody(request, schema)
    await recordMetrics(user, id, {
      ...body,
      measuredAt: body.measuredAt ?? new Date().toISOString(),
    })
    return json({ ok: true })
  })
}
