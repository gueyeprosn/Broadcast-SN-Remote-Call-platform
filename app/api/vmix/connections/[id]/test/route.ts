import { requireCapability } from '@/server/auth/guard'
import { handle, json } from '@/server/http'
import { testConnection } from '@/server/services/vmix'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('vmix.read')
    const { id } = await context.params
    const result = await testConnection(user, id)
    return json({
      ok: true,
      version: result.state.version,
      edition: result.state.edition,
      inputCount: result.state.inputs.length,
      browserInputCount: result.state.inputs.filter((i) => i.isBrowser).length,
    })
  })
}
