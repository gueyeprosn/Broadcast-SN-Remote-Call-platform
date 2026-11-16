import { z } from 'zod'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { syncOnAirFromVmix } from '@/server/services/vmix'

export const dynamic = 'force-dynamic'

const schema = z.object({ sessionId: z.string().min(1) })

/**
 * Relit l'état Program/Overlay de vMix et met à jour les voyants ON AIR.
 * Appelée par la console toutes les 2 s quand une connexion vMix est joignable.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireCapability('vmix.read')
    const { id } = await context.params
    const body = await parseBody(request, schema)
    const result = await syncOnAirFromVmix(id, body.sessionId)
    return json(result)
  })
}
