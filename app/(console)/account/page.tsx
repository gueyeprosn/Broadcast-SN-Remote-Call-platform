import { redirect } from 'next/navigation'
import { Badge, Panel } from '@/components/ui'
import { SelfPasswordForm } from '@/components/console/SelfPasswordForm'
import { currentUser } from '@/server/auth/guard'
import { capabilitiesOf } from '@/lib/rbac'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Mon compte' }

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrateur',
  DIRECTOR: 'Réalisateur',
  TECHNICIAN: 'Technicien',
}

/**
 * Page « Mon compte ».
 *
 * Accessible à **tout utilisateur authentifié**, sans capacité particulière :
 * un technicien n'a accès à aucun écran d'administration, il doit pourtant
 * pouvoir changer son mot de passe.
 */
export default async function AccountPage() {
  const user = await currentUser()
  if (!user) redirect('/login')

  const details = await db.user.findUniqueOrThrow({
    where: { id: user.id },
    select: { lastLoginAt: true, createdAt: true },
  })

  return (
    <main className="mx-auto grid max-w-3xl gap-4 p-4 lg:grid-cols-[1fr_280px]">
      <div className="space-y-3">
        <h1 className="text-sm font-semibold text-txt">Mon compte</h1>

        <Panel title="Identité">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            <dt className="metric-label self-center">Nom</dt>
            <dd className="text-txt">{user.displayName}</dd>
            <dt className="metric-label self-center">Adresse</dt>
            <dd className="font-mono text-2xs text-txt">{user.email}</dd>
            <dt className="metric-label self-center">Rôle</dt>
            <dd>
              <Badge tone="neutral">{ROLE_LABEL[user.role] ?? user.role}</Badge>
            </dd>
            <dt className="metric-label self-center">Dernière connexion</dt>
            <dd className="tabular text-txt">
              {details.lastLoginAt
                ? new Date(details.lastLoginAt).toLocaleString('fr-FR')
                : '—'}
            </dd>
          </dl>
          <p className="mt-3 border-t border-line/50 pt-2 text-2xs text-txt2">
            Votre nom, votre adresse et votre rôle sont modifiés par un
            administrateur. Changer de rôle soi-même n&apos;aurait pas de sens.
          </p>
        </Panel>

        <Panel title="Changer mon mot de passe">
          <SelfPasswordForm />
        </Panel>
      </div>

      <aside className="space-y-3">
        <Panel title="Ce que couvre votre rôle">
          <p className="text-2xs text-txt2">
            {capabilitiesOf(user.role).length} capacités.{' '}
            {user.role === 'ADMIN'
              ? "Tout, y compris la gestion des comptes, des connexions vMix et de la rétention des données."
              : user.role === 'DIRECTOR'
                ? 'Créer les productions, inviter, révoquer, piloter la régie.'
                : "Superviser et piloter l'audio. Ni invitation, ni révocation, ni mise à l'antenne."}
          </p>
        </Panel>

        <Panel title="Pourquoi le mot de passe actuel">
          <p className="text-2xs text-txt2">
            Il est exigé pour que quelqu&apos;un qui trouverait ce poste laissé
            ouvert ne puisse pas vous verrouiller dehors. Un administrateur qui
            réinitialise le mot de passe d&apos;un <em>tiers</em>, lui, n&apos;a pas
            à le connaître : c&apos;est une autre opération.
          </p>
        </Panel>
      </aside>
    </main>
  )
}
