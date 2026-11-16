import { db } from '@/lib/db'
import { currentUser } from '@/server/auth/guard'
import { readParticipantSession } from '@/server/auth/session'
import { replay, sessionTopic, subscribe, type Envelope } from '@/server/events/bus'
import { can } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

/**
 * Flux d'événements applicatifs (Server-Sent Events).
 *
 * Deux publics, deux filtrages :
 *  - console (utilisateur authentifié avec `control.view`) : tout le sujet ;
 *  - correspondant : uniquement ce qui le concerne. Un correspondant ne doit pas
 *    apprendre par ce canal l'état des autres correspondants.
 *
 * Choix de SSE plutôt que WebSocket : voir docs/02-ARCHITECTURE.md §5.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: sessionId } = await context.params

  const user = await currentUser()
  let participantId: string | null = null

  if (!user || !can(user.role, 'control.view')) {
    const participantSession = await readParticipantSession()
    if (!participantSession || participantSession.sid !== sessionId) {
      return new Response('Unauthorized', { status: 401 })
    }
    const participant = await db.participant.findUnique({
      where: { id: participantSession.sub },
      select: { id: true, state: true, session: { select: { tokenEpoch: true } } },
    })
    if (
      !participant ||
      participant.state === 'REVOKED' ||
      participant.session.tokenEpoch !== participantSession.epoch
    ) {
      return new Response('Unauthorized', { status: 401 })
    }
    participantId = participant.id
  } else {
    const session = await db.session.findUnique({
      where: { id: sessionId },
      select: { production: { select: { ownerId: true } } },
    })
    if (!session) return new Response('Not found', { status: 404 })
    if (user.role === 'DIRECTOR' && session.production.ownerId !== user.id) {
      return new Response('Forbidden', { status: 403 })
    }
  }

  const topic = sessionTopic(sessionId)
  const lastEventId = Number.parseInt(request.headers.get('last-event-id') ?? '0', 10)
  const encoder = new TextEncoder()

  const visible = (envelope: Envelope): boolean => {
    if (!participantId) return true
    const event = envelope.event
    switch (event.type) {
      case 'session.state':
      case 'heartbeat':
        return true
      case 'director.message':
        return event.participantId === null || event.participantId === participantId
      case 'talkback.state':
        return event.participantId === participantId
      case 'participant.state':
      case 'participant.onair':
      case 'participant.permissions':
      case 'participant.quality':
      case 'participant.returnbus':
      case 'participant.revoked':
        return event.participantId === participantId
      case 'participant.metrics':
      case 'vmix.mapping':
        return false
      default:
        return false
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false
      const send = (envelope: Envelope) => {
        if (closed || !visible(envelope)) return
        try {
          controller.enqueue(
            encoder.encode(
              `id: ${envelope.id}\nevent: app\ndata: ${JSON.stringify(envelope)}\n\n`,
            ),
          )
        } catch {
          closed = true
        }
      }

      controller.enqueue(encoder.encode(`retry: 3000\n\n`))
      if (Number.isFinite(lastEventId) && lastEventId > 0) {
        for (const envelope of replay(topic, lastEventId)) send(envelope)
      }

      const unsubscribe = subscribe(topic, send)
      // Battement de cœur : maintient la connexion ouverte à travers les proxies
      // et permet au client de détecter une coupure.
      const heartbeat = setInterval(() => {
        if (closed) return
        try {
          controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`))
        } catch {
          closed = true
        }
      }, 20_000)

      const abort = () => {
        if (closed) return
        closed = true
        clearInterval(heartbeat)
        unsubscribe()
        try {
          controller.close()
        } catch {
          /* déjà fermé */
        }
      }
      request.signal.addEventListener('abort', abort)
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      // Désactive la mise en tampon de Nginx pour ce flux.
      'X-Accel-Buffering': 'no',
    },
  })
}
