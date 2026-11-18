import Link from 'next/link'
import { Archive, ChevronRight } from 'lucide-react'
import { Badge, Notice, Panel } from '@/components/ui'
import { NewProductionForm } from '@/components/console/NewProductionForm'
import { NewSessionForm } from '@/components/console/NewSessionForm'
import { ProductionActions } from '@/components/console/ProductionActions'
import { ScrollToAnchor } from '@/components/console/ScrollToAnchor'
import { requirePageCapability } from '@/server/auth/guard'
import { countArchivedProductions, listProductions } from '@/server/services/production'
import { can } from '@/lib/rbac'
import { cn } from '@/lib/cn'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mes émissions' }

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
  'retention.read': 'La rétention des données est réservée aux administrateurs.',
  'retention.run': 'Lancer une purge est réservé aux administrateurs.',
  'user.read': 'La gestion des utilisateurs est réservée aux administrateurs.',
  'user.write': 'La gestion des utilisateurs est réservée aux administrateurs.',
  'vmix.manage': 'La gestion des connexions vMix est réservée aux administrateurs.',
  'control.returnbus': "Le retour programme n'est pas accessible à votre rôle.",
  session: "Cette session n'est pas accessible depuis votre compte.",
}

export default async function ProductionsPage({
  searchParams,
}: {
  searchParams: Promise<{ refuse?: string; nouvelle?: string; archivees?: string }>
}) {
  const user = await requirePageCapability('production.read')
  const { refuse, nouvelle, archivees } = await searchParams
  const showArchived = archivees === '1'

  const [productions, archivedCount] = await Promise.all([
    listProductions(user, { archived: showArchived }),
    countArchivedProductions(user),
  ])

  const mayWrite = can(user.role, 'production.write')
  const refusal = refuse ? (REFUSAL[refuse] ?? 'Accès non autorisé.') : null
  const created = nouvelle ? productions.find((p) => p.id === nouvelle) : undefined

  // Calculée une fois, côté serveur, et passée aux formulaires : la même
  // chaîne au rendu et à l'hydratation, et jamais une date périmée.
  const suggestionEdition = `Édition du ${new Date().toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
  })}`

  return (
    <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-8">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold text-txt">
          {showArchived ? 'Émissions archivées' : 'Mes émissions'}
        </h1>
        <p className="text-sm text-txt2">
          {showArchived
            ? 'Rangées, et conservées telles quelles. Réactivez-en une pour la retrouver dans la liste.'
            : 'Ouvrez une régie pour inviter vos correspondants et récupérer leurs liens vMix.'}
        </p>
      </div>

      {refusal && (
        <Notice tone="warn" title="Accès refusé">
          {refusal}
        </Notice>
      )}

      {created && (
        <>
          <Notice tone="ok" title="Émission créée">
            « {created.name} » est prête. Préparez sa première édition ci-dessous.
          </Notice>
          <ScrollToAnchor targetId={`prod-${created.id}`} />
        </>
      )}

      {/* Le formulaire de création est en TÊTE : placé après la liste, il se
          retrouvait derrière plusieurs dizaines d'émissions, et le résultat de
          la création apparaissait hors écran. */}
      {mayWrite && !showArchived && (
        <details
          className="rounded-lg border border-line bg-surface p-5"
          open={productions.length === 0}
        >
          <summary className="cursor-pointer text-sm font-semibold text-accent">
            + Créer une émission
          </summary>
          <div className="mt-5 max-w-lg">
            <NewProductionForm />
          </div>
        </details>
      )}

      <div className="space-y-3">
        {productions.length === 0 && (
          <Panel>
            <p className="text-sm text-txt2">
              {showArchived
                ? 'Aucune émission archivée.'
                : `Aucune émission. ${mayWrite ? 'Créez-en une pour commencer.' : ''}`}
            </p>
          </Panel>
        )}

        {productions.map((production) => (
          <div key={production.id} id={`prod-${production.id}`}>
            <Panel
              className={cn(
                created?.id === production.id && 'border-ok/50 ring-1 ring-ok/30',
              )}
              title={production.name}
              actions={
                <div className="flex items-center gap-3">
                  <span className="text-2xs text-txt2">
                    {production._count.sessions} édition
                    {production._count.sessions > 1 ? 's' : ''}
                  </span>
                  {mayWrite && (
                    <ProductionActions
                      productionId={production.id}
                      name={production.name}
                      sessionCount={production._count.sessions}
                      archived={showArchived}
                    />
                  )}
                </div>
              }
            >
              {production.description && (
                <p className="mb-3 text-xs text-txt2">{production.description}</p>
              )}

              <div className="space-y-1.5">
                {production.sessions.length === 0 ? (
                  <p className="text-xs text-txt2">Aucune édition active.</p>
                ) : (
                  production.sessions.map((session) => (
                    <Link
                      key={session.id}
                      href={`/control/${session.id}`}
                      className="flex items-center justify-between gap-3 rounded-md border border-line/60 bg-surface2/60 px-2.5 py-2 transition-colors hover:border-accent/40 hover:bg-surface2"
                    >
                      <span className="flex items-center gap-2">
                        <Badge
                          tone={STATE_TONE[session.state]}
                          pulse={session.state === 'LIVE'}
                        >
                          {STATE_LABEL[session.state]}
                        </Badge>
                        <span className="text-sm text-txt">{session.name}</span>
                      </span>
                      <ChevronRight size={14} className="text-txt2" />
                    </Link>
                  ))
                )}
              </div>

              {can(user.role, 'session.write') && !showArchived && (
                <details
                  className="mt-4 border-t border-line/60 pt-4"
                  open={production.sessions.length === 0}
                >
                  <summary className="mb-3 cursor-pointer text-sm text-accent">
                    Préparer une nouvelle édition
                  </summary>
                  <NewSessionForm
                    productionId={production.id}
                    suggestion={suggestionEdition}
                  />
                </details>
              )}
            </Panel>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between gap-4 border-t border-line/60 pt-4 text-xs">
        {/* Le lien n'apparaît que s'il mène quelque part. */}
        {showArchived ? (
          <Link href="/productions" className="text-accent hover:underline">
            ← Revenir aux émissions actives
          </Link>
        ) : archivedCount > 0 ? (
          <Link
            href="/productions?archivees=1"
            className="flex items-center gap-1.5 text-txt2 hover:text-txt"
          >
            <Archive size={13} /> {archivedCount} émission
            {archivedCount > 1 ? 's' : ''} archivée{archivedCount > 1 ? 's' : ''}
          </Link>
        ) : (
          <span />
        )}

        <details className="text-txt2">
          <summary className="cursor-pointer">Comment ça marche ?</summary>
          <ul className="mt-3 space-y-2 text-2xs">
            <li>
              Une <strong className="text-txt">émission</strong> est récurrente. Une{' '}
              <strong className="text-txt">édition</strong> porte sa propre salle média
              et ses propres invitations.
            </li>
            <li>
              Les liens vMix et les liens correspondants sont générés par édition,
              jamais réutilisés de l&apos;une à l&apos;autre.
            </li>
            <li>
              <strong className="text-txt">Archiver</strong> range une émission sans rien
              perdre. La <strong className="text-txt">suppression</strong> n&apos;est
              offerte que pour une émission qui n&apos;a jamais porté d&apos;édition.
            </li>
          </ul>
        </details>
      </div>
    </main>
  )
}
