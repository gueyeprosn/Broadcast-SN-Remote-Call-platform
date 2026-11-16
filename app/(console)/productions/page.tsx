import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import { Badge, Notice, Panel } from '@/components/ui'
import { NewProductionForm } from '@/components/console/NewProductionForm'
import { NewSessionForm } from '@/components/console/NewSessionForm'
import { requirePageCapability } from '@/server/auth/guard'
import { listProductions } from '@/server/services/production'
import { can } from '@/lib/rbac'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Productions' }

const STATE_TONE = {
  SCHEDULED: 'neutral',
  LIVE: 'crit',
  ENDED: 'neutral',
} as const

const STATE_LABEL = {
  SCHEDULED: 'Préparée',
  LIVE: 'En direct',
  ENDED: 'Terminée',
} as const

/** Motifs de renvoi, traduits pour que l'utilisateur comprenne au lieu de deviner. */
const REFUSAL: Record<string, string> = {
  'retention.read': "La rétention des données est réservée aux administrateurs.",
  'retention.run': "Lancer une purge est réservé aux administrateurs.",
  'user.read': 'La gestion des utilisateurs est réservée aux administrateurs.',
  'user.write': 'La gestion des utilisateurs est réservée aux administrateurs.',
  'vmix.manage': 'La gestion des connexions vMix est réservée aux administrateurs.',
  'control.returnbus': "Le retour programme n'est pas accessible à votre rôle.",
  session: "Cette session n'est pas accessible depuis votre compte.",
}

export default async function ProductionsPage({
  searchParams,
}: {
  searchParams: Promise<{ refuse?: string }>
}) {
  const user = await requirePageCapability('production.read')
  const productions = await listProductions(user)
  const mayWrite = can(user.role, 'production.write')
  const { refuse } = await searchParams
  const refusal = refuse ? (REFUSAL[refuse] ?? 'Accès non autorisé.') : null

  return (
    <main className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <h1 className="text-sm font-semibold text-txt">Productions</h1>

        {refusal && <Notice tone="warn" title="Accès refusé">{refusal}</Notice>}

        {productions.length === 0 && (
          <Panel>
            <p className="text-sm text-txt2">
              Aucune production. {mayWrite ? 'Créez-en une pour commencer.' : ''}
            </p>
          </Panel>
        )}

        {productions.map((production) => (
          <Panel
            key={production.id}
            title={production.name}
            actions={
              <span className="text-2xs text-txt2">
                {production._count.sessions} session
                {production._count.sessions > 1 ? 's' : ''}
              </span>
            }
          >
            {production.description && (
              <p className="mb-3 text-xs text-txt2">{production.description}</p>
            )}

            <div className="space-y-1.5">
              {production.sessions.length === 0 ? (
                <p className="text-xs text-txt2">Aucune session active.</p>
              ) : (
                production.sessions.map((session) => (
                  <Link
                    key={session.id}
                    href={`/control/${session.id}`}
                    className="flex items-center justify-between gap-3 rounded-md border border-line/60 bg-surface2/60 px-2.5 py-2 transition-colors hover:border-accent/40 hover:bg-surface2"
                  >
                    <span className="flex items-center gap-2">
                      <Badge tone={STATE_TONE[session.state]} pulse={session.state === 'LIVE'}>
                        {STATE_LABEL[session.state]}
                      </Badge>
                      <span className="text-sm text-txt">{session.name}</span>
                    </span>
                    <ChevronRight size={14} className="text-txt2" />
                  </Link>
                ))
              )}
            </div>

            {can(user.role, 'session.write') && (
              <div className="mt-3 border-t border-line/60 pt-3">
                <NewSessionForm productionId={production.id} />
              </div>
            )}
          </Panel>
        ))}
      </div>

      <aside className="space-y-3">
        {mayWrite && (
          <Panel title="Nouvelle production">
            <NewProductionForm />
          </Panel>
        )}
        <Panel title="Rappel">
          <ul className="space-y-2 text-xs text-txt2">
            <li>
              Une <strong className="text-txt">production</strong> est une émission
              récurrente. Une <strong className="text-txt">session</strong> est une
              édition : elle porte sa propre salle média et ses propres invitations.
            </li>
            <li>
              Les liens vMix et les liens correspondants sont générés par session,
              jamais réutilisés d&apos;une édition à l&apos;autre.
            </li>
          </ul>
        </Panel>
      </aside>
    </main>
  )
}
