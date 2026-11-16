import { clearUserSession } from '@/server/auth/session'
import { currentUser } from '@/server/auth/guard'
import { handle, json } from '@/server/http'
import { audit, requestContext } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  return handle(async () => {
    const user = await currentUser()
    await clearUserSession()
    if (user) {
      const context = requestContext(request.headers)
      await audit({
        action: 'auth.logout',
        actorId: user.id,
        actorLabel: user.displayName,
        ip: context.ip,
        userAgent: context.userAgent,
      })
    }
    return json({ ok: true })
  })
}
