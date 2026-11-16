import { Notice, Panel } from '@/components/ui'
import { RetentionAdmin } from '@/components/console/RetentionAdmin'
import { requirePageCapability } from '@/server/auth/guard'
import { can } from '@/lib/rbac'
import { retentionStatus } from '@/server/services/retention'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Rétention des données' }

export default async function RetentionPage() {
  const user = await requirePageCapability('retention.read')
  const status = await retentionStatus()

  // Les dernières exécutions, lues dans le journal d'audit : c'est lui qui fait
  // foi, pas un compteur séparé qui pourrait en divergeant mentir.
  const runs = await db.auditLog.findMany({
    where: { action: 'retention.run' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: {
      id: true,
      createdAt: true,
      outcome: true,
      actorKind: true,
      actorLabel: true,
      detail: true,
    },
  })

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <h1 className="text-sm font-semibold text-txt">Rétention des données</h1>
        <RetentionAdmin
          status={status}
          canRun={can(user.role, 'retention.run')}
          runs={runs.map((run) => ({
            id: run.id,
            at: run.createdAt.toISOString(),
            outcome: run.outcome,
            actorKind: run.actorKind,
            actorLabel: run.actorLabel,
            detail: run.detail as Record<string, unknown> | null,
          }))}
        />
      </div>

      <aside className="space-y-3">
        <Panel title="Ce qui est conservé">
          <ul className="space-y-2.5 text-2xs text-txt2">
            <li>
              <strong className="text-txt">Aucun média.</strong> Ni audio, ni vidéo, à
              aucun moment. Il n&apos;y a donc rien à purger de ce côté.
            </li>
            <li>
              <strong className="text-txt">Session terminée</strong> : correspondants,
              invitations, événements de connexion, mappings vMix. Supprimés{' '}
              {status.policy.sessionDays} jours après la fin.
            </li>
            <li>
              <strong className="text-txt">Journal d&apos;audit</strong> :{' '}
              {status.policy.auditDays === null ? (
                <>
                  <span className="text-ok">jamais purgé</span> — c&apos;est le réglage
                  par défaut et le plus sûr. Le supprimer doit être une décision
                  explicite.
                </>
              ) : (
                <>purgé au-delà de {status.policy.auditDays} jours.</>
              )}
            </li>
            <li>
              <strong className="text-txt">Compteurs de limitation de débit</strong> :
              purgés dès leur fenêtre expirée.
            </li>
          </ul>
        </Panel>

        <Panel title="Réglage">
          <p className="text-2xs text-txt2">
            Les durées viennent de <code className="text-txt">RETENTION_DAYS</code> et{' '}
            <code className="text-txt">AUDIT_RETENTION_DAYS</code>. Elles ne sont pas
            modifiables depuis cette page : changer une politique de conservation est
            une décision de déploiement, pas un clic en cours d&apos;émission.
          </p>
        </Panel>

        <Notice tone="warn" title="Suppression définitive">
          La purge est irréversible. Vérifiez que vos sauvegardes sont restaurables
          avant de réduire une durée de conservation.
        </Notice>
      </aside>
    </main>
  )
}
