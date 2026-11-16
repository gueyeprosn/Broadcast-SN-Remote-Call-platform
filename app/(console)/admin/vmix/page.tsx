import { db } from '@/lib/db'
import { Notice, Panel } from '@/components/ui'
import { VmixAdmin } from '@/components/console/VmixAdmin'
import { requirePageCapability } from '@/server/auth/guard'
import { can } from '@/lib/rbac'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Connexions vMix' }

export default async function VmixAdminPage() {
  const user = await requirePageCapability('vmix.read')
  const connections = await db.vmixConnection.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      label: true,
      host: true,
      port: true,
      mode: true,
      allowAddInput: true,
      allowProgramControl: true,
      returnBuses: true,
      lastCheckedAt: true,
      lastStatus: true,
      vmixVersion: true,
      vmixEdition: true,
    },
  })

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-4 lg:grid-cols-[1fr_320px]">
      <div className="space-y-3">
        <h1 className="text-sm font-semibold text-txt">Connexions vMix</h1>
        <VmixAdmin
          connections={connections.map((c) => ({
            ...c,
            lastCheckedAt: c.lastCheckedAt?.toISOString() ?? null,
          }))}
          canManage={can(user.role, 'vmix.manage')}
        />
      </div>

      <aside className="space-y-3">
        <Panel title="Règles appliquées">
          <ul className="space-y-2.5 text-2xs text-txt2">
            <li>
              <strong className="text-txt">Mode DIRECT</strong> : le serveur joint vMix
              lui-même. Il est <strong className="text-txt">refusé</strong> si
              l&apos;adresse n&apos;est pas privée ou de bouclage — ce n&apos;est pas un
              avertissement, c&apos;est un refus à l&apos;exécution.
            </li>
            <li>
              <strong className="text-txt">Mode AGENT</strong> : un petit service tourne
              sur le PC de régie et établit une connexion sortante. Aucun port entrant
              n&apos;est ouvert sur la machine de régie, et l&apos;agent applique sa
              propre liste blanche.
            </li>
            <li>
              L&apos;API HTTP de vMix{' '}
              <strong className="text-txt">ne documente aucune authentification</strong>.
              Elle ne doit jamais être joignable depuis Internet.
            </li>
            <li>
              <strong className="text-txt">AddInput</strong> pour le type Browser
              n&apos;est pas documenté officiellement. Le drapeau existe, il est désactivé
              par défaut, et la voie recommandée reste : créer les entrées Web Browser à
              la main dans vMix, puis les pointer avec <code>BrowserNavigate</code>.
            </li>
            <li>
              Les bus déclarés comme <strong className="text-txt">bus de retour</strong>{' '}
              sont protégés : l&apos;application refuse d&apos;y ajouter un correspondant
              et refuse <code>BusXSendToMaster</code>.
            </li>
          </ul>
        </Panel>

        <Notice tone="warn" title="Essais encore nécessaires">
          Deux points ne peuvent être validés que sur une installation vMix réelle sous
          Windows : la création d&apos;entrée par l&apos;API, et les autorisations
          micro/caméra dans une entrée Web Browser. Voir docs/10-TEST-REPORT.md.
        </Notice>
      </aside>
    </main>
  )
}
