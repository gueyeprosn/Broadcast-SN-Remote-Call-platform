import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { QUALITY_PROFILES } from '@/lib/media/engine'
import { engine } from '@/lib/media/vdoninja'
import { capabilitiesOf } from '@/lib/rbac'
import { pageAccessDenied, requirePageCapability } from '@/server/auth/guard'
import { getSessionForConsole } from '@/server/services/session'
import { outputPageUrl } from '@/server/services/participant'
import { ControlRoom } from '@/components/console/ControlRoom'

export const dynamic = 'force-dynamic'

export async function generateMetadata({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const { sessionId } = await params
  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: { name: true, production: { select: { name: true } } },
  })
  return { title: session ? `${session.production.name} — ${session.name}` : 'Régie' }
}

export default async function ControlPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  const user = await requirePageCapability('control.view')
  const { sessionId } = await params

  // Une session inexistante et une session appartenant à un autre réalisateur
  // mènent au même endroit : la liste des productions. Distinguer les deux
  // révélerait qu'une session existe, ce qui n'est l'affaire de personne.
  // `redirect()` lève une erreur interne à Next : l'appel se fait donc HORS du
  // `try`, jamais dedans.
  let loaded: Awaited<ReturnType<typeof getSessionForConsole>> | null = null
  let failure: unknown = null
  try {
    loaded = await getSessionForConsole(user, sessionId)
  } catch (error) {
    failure = error
  }
  if (!loaded) pageAccessDenied(failure, 'session')

  const session = loaded
  const eng = engine()

  // L'URL director contient le secret de salle : elle n'est construite que pour
  // un utilisateur déjà autorisé sur cette session, et n'est pas persistée.
  const directorUrl = eng.directorUrl({
    roomName: session.roomName,
    roomSecret: session.roomSecret,
  })

  const returnPublisherPath = `/return/${session.id}`

  const vmixConnections = await db.vmixConnection.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      label: true,
      host: true,
      port: true,
      mode: true,
      lastStatus: true,
      lastCheckedAt: true,
      returnBuses: true,
    },
  })

  const events = await db.connectionEvent.findMany({
    where: { sessionId },
    orderBy: { createdAt: 'desc' },
    take: 60,
    select: {
      id: true,
      type: true,
      message: true,
      createdAt: true,
      participantId: true,
    },
  })

  const participants = session.participants.map((participant) => ({
    id: participant.id,
    displayName: participant.displayName,
    role: participant.role,
    state: participant.state,
    streamId: participant.streamId,
    onAir: participant.onAir,
    onAirSource: participant.onAirSource,
    micAllowed: participant.micAllowed,
    cameraAllowed: participant.cameraAllowed,
    qualityProfile: participant.qualityProfile,
    returnBus: participant.returnBus,
    vmixUrl: outputPageUrl(env().APP_URL, participant.outputKey),
    mapping:
      session.mappings.find((m) => m.participantId === participant.id) ?? null,
  }))

  return (
    <ControlRoom
      session={{
        id: session.id,
        name: session.name,
        state: session.state,
        productionName: session.production.name,
        roomName: session.roomName,
        returnStreamId: session.returnStreamId,
      }}
      participants={participants.map((p) => ({
        ...p,
        mapping: p.mapping
          ? {
              connectionId: p.mapping.connectionId,
              inputKey: p.mapping.inputKey,
              inputNumber: p.mapping.inputNumber,
              inputTitle: p.mapping.inputTitle,
              lastError: p.mapping.lastError,
            }
          : null,
      }))}
      directorUrl={directorUrl}
      engineOrigin={eng.origin}
      capabilities={eng.capabilities}
      userCapabilities={[...capabilitiesOf(user.role)]}
      qualityProfiles={Object.values(QUALITY_PROFILES)}
      vmixConnections={vmixConnections.map((c) => ({
        ...c,
        lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
      }))}
      returnPublisherPath={returnPublisherPath}
      initialEvents={events.map((e) => ({
        id: e.id,
        type: e.type,
        message: e.message,
        participantId: e.participantId,
        at: e.createdAt.toISOString(),
      }))}
    />
  )
}
