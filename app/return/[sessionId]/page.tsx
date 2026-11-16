import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { engine } from '@/lib/media/vdoninja'
import { requirePageCapability } from '@/server/auth/guard'
import { ReturnPublisher } from '@/components/console/ReturnPublisher'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Retour programme', robots: { index: false } }

/**
 * Page de publication du retour programme.
 *
 * Elle s'ouvre dans un **vrai navigateur** sur le PC de régie, jamais dans une
 * entrée Web Browser de vMix : la documentation vMix ne garantit pas les
 * autorisations micro/caméra dans cette entrée (docs/01-AUDIT.md §4.1, R2).
 *
 * Elle exige une session utilisateur authentifiée : publier dans la salle n'est
 * pas une action publique.
 */
export default async function ReturnPage({
  params,
}: {
  params: Promise<{ sessionId: string }>
}) {
  await requirePageCapability('control.returnbus')
  const { sessionId } = await params

  const session = await db.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      name: true,
      state: true,
      returnStreamId: true,
      production: { select: { name: true } },
    },
  })
  if (!session) notFound()

  return (
    <ReturnPublisher
      sessionId={session.id}
      sessionName={`${session.production.name} — ${session.name}`}
      sessionState={session.state}
      returnStreamId={session.returnStreamId}
      engineOrigin={engine().origin}
    />
  )
}
