import { handle, json, problem } from '@/server/http'
import { createParticipantSession } from '@/server/auth/session'
import {
  consumeInvitationUse,
  FAILURE_MESSAGES,
  resolveInvitation,
} from '@/server/services/invitation'
import { markState } from '@/server/services/participant'
import { audit, requestContext } from '@/server/services/audit'
import { clientIp, enforce } from '@/server/services/ratelimit'

export const dynamic = 'force-dynamic'

/**
 * Échange d'un jeton d'invitation contre un cookie de participant.
 *
 * POST et non GET : l'ouverture consomme un usage, ce qui n'est pas une
 * opération idempotente et ne doit pas être déclenchée par un préchargement de
 * lien ou un antivirus qui suit les URL d'un courriel.
 */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  return handle(async () => {
    const ip = clientIp(request.headers)
    const requestCtx = requestContext(request.headers)
    // Freine l'énumération de jetons.
    await enforce({ key: `invite:ip:${ip}`, limit: 30, windowSeconds: 300 })

    const { token } = await context.params
    const resolved = await resolveInvitation(token)

    if (!resolved.ok) {
      await audit({
        action: 'invitation.use',
        actorKind: 'participant',
        outcome: 'denied',
        detail: { reason: resolved.reason, tokenHint: token.slice(0, 8) },
        ip: requestCtx.ip,
        userAgent: requestCtx.userAgent,
      })
      const status = resolved.reason === 'not_found' ? 404 : 403
      return problem(status, FAILURE_MESSAGES[resolved.reason], resolved.reason)
    }

    const consumed = await consumeInvitationUse(resolved.invitation.id, requestCtx.ip)
    if (!consumed) {
      return problem(409, FAILURE_MESSAGES.exhausted, 'exhausted')
    }

    await createParticipantSession(
      resolved.participant.id,
      resolved.session.id,
      resolved.session.tokenEpoch,
      resolved.ttlSeconds,
    )
    await markState(resolved.participant.id, 'READY')
    await audit({
      action: 'invitation.use',
      actorKind: 'participant',
      actorLabel: resolved.participant.displayName,
      target: resolved.participant.id,
      outcome: 'ok',
      ip: requestCtx.ip,
      userAgent: requestCtx.userAgent,
    })

    return json({
      participant: {
        id: resolved.participant.id,
        displayName: resolved.participant.displayName,
        qualityProfile: resolved.participant.qualityProfile,
      },
      session: {
        id: resolved.session.id,
        name: resolved.session.name,
        productionName: resolved.session.productionName,
      },
      expiresAt: resolved.invitation.expiresAt.toISOString(),
    })
  })
}
