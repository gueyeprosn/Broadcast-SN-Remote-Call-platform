import { requireCapability } from '@/server/auth/guard'
import { handle, json } from '@/server/http'
import { listInputs } from '@/server/services/vmix'

export const dynamic = 'force-dynamic'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    await requireCapability('vmix.read')
    const { id } = await context.params
    const state = await listInputs(id)
    return json({
      version: state.version,
      edition: state.edition,
      activeNumber: state.activeNumber,
      previewNumber: state.previewNumber,
      inputs: state.inputs,
    })
  })
}
