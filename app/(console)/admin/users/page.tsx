import { db } from '@/lib/db'
import { Panel } from '@/components/ui'
import { UsersAdmin } from '@/components/console/UsersAdmin'
import { requirePageCapability } from '@/server/auth/guard'
import { can } from '@/lib/rbac'
import { capabilitiesOf } from '@/lib/rbac'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Utilisateurs' }

const ROLES = ['ADMIN', 'DIRECTOR', 'TECHNICIAN'] as const

export default async function UsersPage() {
  const actor = await requirePageCapability('user.read')
  const users = await db.user.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      isActive: true,
      lastLoginAt: true,
      lockedUntil: true,
    },
  })

  return (
    <main className="mx-auto grid max-w-5xl gap-4 p-4 lg:grid-cols-[1fr_300px]">
      <div className="space-y-3">
        <h1 className="text-sm font-semibold text-txt">Utilisateurs</h1>
        <UsersAdmin
          users={users.map((user) => ({
            ...user,
            lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
            lockedUntil: user.lockedUntil?.toISOString() ?? null,
          }))}
          currentUserId={actor.id}
          canManage={can(actor.role, 'user.write')}
        />
      </div>

      <aside className="space-y-3">
        <Panel title="Rôles">
          <dl className="space-y-3 text-2xs">
            {ROLES.map((role) => (
              <div key={role}>
                <dt className="font-semibold uppercase tracking-wider text-txt">{role}</dt>
                <dd className="mt-0.5 text-txt2">
                  {capabilitiesOf(role).length} capacités —{' '}
                  {role === 'ADMIN'
                    ? 'tout, y compris la gestion des comptes et des connexions vMix.'
                    : role === 'DIRECTOR'
                      ? 'crée les productions, invite, révoque, pilote la régie.'
                      : "supervise et pilote l'audio ; n'invite pas et ne révoque pas."}
                </dd>
              </div>
            ))}
          </dl>
        </Panel>
        <Panel title="Note">
          <p className="text-2xs text-txt2">
            Un correspondant n&apos;est pas un compte : il est authentifié par un lien
            d&apos;invitation limité en durée et en nombre d&apos;ouvertures, restreint à
            une seule session.
          </p>
        </Panel>
      </aside>
    </main>
  )
}
