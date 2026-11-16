'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eraser, RefreshCw, TriangleAlert } from 'lucide-react'
import { Badge, Button, Metric, Notice, Panel } from '@/components/ui'
import type { RetentionStatus } from '@/server/services/retention'

interface RunRow {
  id: string
  at: string
  outcome: string
  actorKind: string
  actorLabel: string | null
  detail: Record<string, unknown> | null
}

interface Report {
  repairedPurgeDates: number
  deletedSessions: number
  deletedConnectionEvents: number
  deletedRateLimits: number
  deletedAuditRows: number
  durationMs: number
}

export function RetentionAdmin({
  status,
  canRun,
  runs,
}: {
  status: RetentionStatus
  canRun: boolean
  runs: RunRow[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  const nothingToDo =
    status.sessionsDue === 0 &&
    status.sessionsMissingPurgeDate === 0 &&
    status.staleConnectionEvents === 0 &&
    status.expiredRateLimits === 0 &&
    status.auditRowsOutsideWindow === 0

  async function run() {
    const toDelete = [
      status.sessionsDue > 0 && `${status.sessionsDue} session(s) terminée(s)`,
      status.staleConnectionEvents > 0 && `${status.staleConnectionEvents} événement(s)`,
      status.auditRowsOutsideWindow > 0 &&
        `${status.auditRowsOutsideWindow} ligne(s) de journal d'audit`,
    ].filter(Boolean)

    const confirmed = window.confirm(
      toDelete.length > 0
        ? `Supprimer définitivement :\n\n• ${toDelete.join('\n• ')}\n\n` +
            'Cette action est irréversible.'
        : 'Lancer la purge ? Rien ne semble à supprimer pour le moment.',
    )
    if (!confirmed) return

    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const response = await fetch('/api/admin/retention', { method: 'POST' })
      const data = (await response.json()) as {
        report?: Report
        error?: { message?: string }
      }
      if (!response.ok || !data.report) {
        setError(data.error?.message ?? 'Purge refusée.')
        return
      }
      setReport(data.report)
      router.refresh()
    } catch {
      setError('Le serveur est injoignable.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      {error && <Notice tone="crit">{error}</Notice>}

      {report && (
        <Notice tone="ok" title="Purge effectuée">
          <ul className="space-y-0.5 text-2xs">
            <li>{report.deletedSessions} session(s) supprimée(s), avec leurs données liées</li>
            <li>{report.deletedConnectionEvents} événement(s) ancien(s) supprimé(s)</li>
            <li>{report.deletedRateLimits} compteur(s) de limitation purgé(s)</li>
            <li>{report.deletedAuditRows} ligne(s) de journal d&apos;audit supprimée(s)</li>
            {report.repairedPurgeDates > 0 && (
              <li className="text-warn">
                {report.repairedPurgeDates} session(s) terminée(s) sans date de purge :
                date posée, suppression au prochain passage
              </li>
            )}
            <li className="text-txt2">Durée : {report.durationMs} ms</li>
          </ul>
        </Notice>
      )}

      <Panel
        title="État"
        actions={
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => router.refresh()}>
              <RefreshCw size={12} /> Actualiser
            </Button>
            {canRun && (
              <Button
                size="sm"
                variant={status.sessionsDue > 0 ? 'primary' : 'secondary'}
                disabled={busy}
                onClick={() => void run()}
              >
                <Eraser size={12} /> {busy ? 'Purge…' : 'Lancer la purge'}
              </Button>
            )}
          </div>
        }
      >
        <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
          <Metric
            label="Sessions à supprimer maintenant"
            value={status.sessionsDue}
            tone={status.sessionsDue > 0 ? 'warn' : 'neutral'}
          />
          <Metric label="Sessions en attente de purge" value={status.sessionsPending} />
          <Metric
            label="Sessions sans date de purge"
            value={status.sessionsMissingPurgeDate}
            tone={status.sessionsMissingPurgeDate > 0 ? 'warn' : 'neutral'}
          />
          <Metric label="Événements anciens (sessions ouvertes)" value={status.staleConnectionEvents} />
          <Metric label="Compteurs de limitation expirés" value={status.expiredRateLimits} />
          <Metric label="Lignes de journal d'audit" value={status.auditRowsTotal} />
          <Metric
            label="Audit hors fenêtre"
            value={status.policy.auditDays === null ? null : status.auditRowsOutsideWindow}
          />
          <Metric
            label="Prochaine purge"
            value={
              status.nextPurgeAt
                ? new Date(status.nextPurgeAt).toLocaleDateString('fr-FR')
                : null
            }
          />
        </div>

        {nothingToDo && (
          <p className="mt-3 border-t border-line/50 pt-2 text-2xs text-txt2">
            Rien à supprimer pour le moment.
          </p>
        )}

        {status.policy.auditDays === null && (
          <p className="mt-3 border-t border-line/50 pt-2 text-2xs text-txt2">
            « Audit hors fenêtre » affiche « — » parce qu&apos;aucune fenêtre
            n&apos;est définie : le journal d&apos;audit n&apos;est jamais purgé.
          </p>
        )}
      </Panel>

      {(status.abandonedScheduledSessions > 0 || status.staleLiveSessions > 0) && (
        <Panel title="Signalements">
          <div className="space-y-2 text-xs">
            {status.staleLiveSessions > 0 && (
              <p className="flex gap-1.5">
                <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" />
                <span>
                  <strong className="text-txt">
                    {status.staleLiveSessions} session(s) « en direct » depuis plus de 24 h.
                  </strong>{' '}
                  Vraisemblablement un « Terminer » oublié. Tant qu&apos;elles sont
                  ouvertes, leurs liens d&apos;invitation restent valables. La purge ne
                  les touche pas : terminez-les depuis leur régie.
                </span>
              </p>
            )}
            {status.abandonedScheduledSessions > 0 && (
              <p className="flex gap-1.5">
                <TriangleAlert size={13} className="mt-0.5 shrink-0 text-txt2" />
                <span>
                  {status.abandonedScheduledSessions} session(s) préparée(s) puis jamais
                  démarrée(s), plus anciennes que {status.policy.sessionDays} jours. La
                  purge ne les supprime pas : seul un humain sait si elles comptent
                  encore.
                </span>
              </p>
            )}
          </div>
        </Panel>
      )}

      <Panel title="Dernières exécutions" bodyClassName="p-0">
        {runs.length === 0 ? (
          <p className="p-3 text-xs text-txt2">
            Aucune exécution enregistrée. Si la purge planifiée est configurée, elle
            apparaîtra ici après son premier passage.
          </p>
        ) : (
          <table className="w-full text-2xs">
            <thead>
              <tr className="border-b border-line/70 text-left">
                <th className="px-3 py-1.5 font-medium text-txt2">Date</th>
                <th className="px-3 py-1.5 font-medium text-txt2">Déclencheur</th>
                <th className="px-3 py-1.5 font-medium text-txt2">Sessions</th>
                <th className="px-3 py-1.5 font-medium text-txt2">Événements</th>
                <th className="px-3 py-1.5 font-medium text-txt2">Résultat</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-b border-line/40 last:border-0">
                  <td className="tabular px-3 py-1.5 text-txt">
                    {new Date(run.at).toLocaleString('fr-FR')}
                  </td>
                  <td className="px-3 py-1.5 text-txt2">
                    {run.actorKind === 'system' ? 'planificateur' : (run.actorLabel ?? 'régie')}
                  </td>
                  <td className="tabular px-3 py-1.5 text-txt">
                    {numberOf(run.detail, 'deletedSessions')}
                  </td>
                  <td className="tabular px-3 py-1.5 text-txt">
                    {numberOf(run.detail, 'deletedConnectionEvents')}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge tone={run.outcome === 'ok' ? 'ok' : 'crit'}>{run.outcome}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  )
}

function numberOf(detail: Record<string, unknown> | null, key: string): string {
  const value = detail?.[key]
  // « — » et non « 0 » quand l'information n'a pas été consignée : un échec
  // d'exécution n'a pas supprimé zéro élément, il n'a rien rapporté.
  return typeof value === 'number' ? String(value) : '—'
}
