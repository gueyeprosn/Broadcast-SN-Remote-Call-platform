import { requireCapability } from '@/server/auth/guard'
import { handle, json } from '@/server/http'
import { revokeInvitation } from '@/server/services/invitation'

export const dynamic = 'force-dynamic'

/** Révocation d'une invitation. Immédiate et irréversible. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('invitation.revoke')
    const { id } = await context.params
    const invitation = await revokeInvitation(user, id)
    return json({ invitation: { id: invitation.id, revokedAt: invitation.revokedAt } })
  })
}
