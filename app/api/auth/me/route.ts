import { currentUser } from '@/server/auth/guard'
import { capabilitiesOf } from '@/lib/rbac'
import { handle, json } from '@/server/http'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => {
    const user = await currentUser()
    if (!user) return json({ user: null, capabilities: [] }, 200)
    return json({ user, capabilities: capabilitiesOf(user.role) })
  })
}
