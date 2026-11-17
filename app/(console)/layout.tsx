import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Eraser, LogOut, Radio, Settings2, Users } from 'lucide-react'
import { Brand } from '@/components/Brand'
import { LogoutButton } from '@/components/LogoutButton'
import { currentUser } from '@/server/auth/guard'
import { can } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

const ROLE_LABEL: Record<string, string> = {
  ADMIN: 'Administrateur',
  DIRECTOR: 'Réalisateur',
  TECHNICIAN: 'Technicien',
}

export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser()
  if (!user) redirect('/login')

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-line/70 bg-surface px-4">
        <div className="flex items-center gap-6">
          <Brand size="sm" />
          <nav className="flex items-center gap-1 text-xs">
            <Link
              href="/"
              className="flex items-center gap-1.5 rounded px-2 py-1 text-txt2 transition-colors hover:bg-surface2 hover:text-txt"
            >
              <Radio size={13} /> Régie
            </Link>
            {can(user.role, 'vmix.read') && (
              <Link
                href="/admin/vmix"
                className="flex items-center gap-1.5 rounded px-2 py-1 text-txt2 transition-colors hover:bg-surface2 hover:text-txt"
              >
                <Settings2 size={13} /> vMix
              </Link>
            )}
            {can(user.role, 'user.read') && (
              <Link
                href="/admin/users"
                className="flex items-center gap-1.5 rounded px-2 py-1 text-txt2 transition-colors hover:bg-surface2 hover:text-txt"
              >
                <Users size={13} /> Utilisateurs
              </Link>
            )}
            {can(user.role, 'retention.read') && (
              <Link
                href="/admin/retention"
                className="flex items-center gap-1.5 rounded px-2 py-1 text-txt2 transition-colors hover:bg-surface2 hover:text-txt"
              >
                <Eraser size={13} /> Rétention
              </Link>
            )}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {/* Accessible à tous les rôles : un technicien n'a aucun écran
              d'administration, il doit pourtant pouvoir changer son mot de passe. */}
          <Link
            href="/account"
            title="Mon compte"
            className="rounded px-2 py-1 text-right leading-tight transition-colors hover:bg-surface2"
          >
            <p className="text-xs text-txt">{user.displayName}</p>
            <p className="text-2xs uppercase tracking-wider text-txt2">
              {ROLE_LABEL[user.role] ?? user.role}
            </p>
          </Link>
          <LogoutButton>
            <LogOut size={13} />
          </LogoutButton>
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  )
}
