'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { KeyRound, Plus, UserCheck, UserX } from 'lucide-react'
import { Badge, Button, Field, Input, Notice, Panel, Select } from '@/components/ui'

interface UserRow {
  id: string
  email: string
  displayName: string
  role: 'ADMIN' | 'DIRECTOR' | 'TECHNICIAN'
  isActive: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
}

const MIN_PASSWORD = 12

export function UsersAdmin({
  users,
  currentUserId,
  canManage,
}: {
  users: UserRow[]
  currentUserId: string
  canManage: boolean
}) {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<UserRow['role']>('DIRECTOR')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(path: string, init: RequestInit) {
    setBusy(true)
    setError(null)
    const response = await fetch(path, init)
    setBusy(false)
    if (!response.ok) {
      const data = (await response.json()) as { error?: { message?: string } }
      setError(data.error?.message ?? 'Action refusée.')
      return false
    }
    router.refresh()
    return true
  }

  async function create(event: React.FormEvent) {
    event.preventDefault()
    const ok = await send('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, displayName, role, password }),
    })
    if (ok) {
      setEmail('')
      setDisplayName('')
      setPassword('')
    }
  }

  return (
    <div className="space-y-3">
      {error && <Notice tone="crit">{error}</Notice>}

      <Panel title="Comptes" bodyClassName="p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-line/70 text-left">
              <th className="px-3 py-2 font-medium text-txt2">Nom</th>
              <th className="px-3 py-2 font-medium text-txt2">Adresse</th>
              <th className="px-3 py-2 font-medium text-txt2">Rôle</th>
              <th className="px-3 py-2 font-medium text-txt2">Dernière connexion</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className="border-b border-line/40 last:border-0">
                <td className="px-3 py-2 text-txt">
                  {user.displayName}
                  {user.id === currentUserId && (
                    <span className="ml-1.5 text-2xs text-txt2">(vous)</span>
                  )}
                </td>
                <td className="px-3 py-2 font-mono text-2xs text-txt2">{user.email}</td>
                <td className="px-3 py-2">
                  {canManage && user.id !== currentUserId ? (
                    <Select
                      aria-label={`Rôle de ${user.displayName}`}
                      className="h-7 py-0 text-2xs"
                      value={user.role}
                      disabled={busy}
                      onChange={(e) =>
                        void send(`/api/users/${user.id}`, {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ role: e.target.value }),
                        })
                      }
                    >
                      <option value="ADMIN">ADMIN</option>
                      <option value="DIRECTOR">DIRECTOR</option>
                      <option value="TECHNICIAN">TECHNICIAN</option>
                    </Select>
                  ) : (
                    <Badge tone="neutral">{user.role}</Badge>
                  )}
                </td>
                <td className="px-3 py-2 tabular text-2xs text-txt2">
                  {user.lastLoginAt
                    ? new Date(user.lastLoginAt).toLocaleString('fr-FR')
                    : 'jamais'}
                  {user.lockedUntil && new Date(user.lockedUntil) > new Date() && (
                    <Badge tone="crit" className="ml-1.5">
                      verrouillé
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-right">
                  {user.id === currentUserId ? (
                    // Sur sa propre ligne : pas de désactivation ni de
                    // rétrogradation — mais le changement de mot de passe doit
                    // rester accessible. Il passe par « Mon compte », qui exige
                    // le mot de passe actuel.
                    <Link
                      href="/account"
                      className="inline-flex h-7 items-center gap-1.5 rounded-md border border-line bg-surface2 px-2 text-xs text-txt transition-colors hover:bg-line"
                      title="Changer mon mot de passe"
                    >
                      <KeyRound size={12} /> Mon mot de passe
                    </Link>
                  ) : (
                    canManage && (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        title="Réinitialiser le mot de passe"
                        disabled={busy}
                        onClick={() => {
                          const next = window.prompt(
                            `Nouveau mot de passe pour ${user.displayName} ` +
                              `(${MIN_PASSWORD} caractères minimum) :`,
                          )
                          if (!next) return
                          void send(`/api/users/${user.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ password: next }),
                          })
                        }}
                      >
                        <KeyRound size={12} />
                      </Button>
                      <Button
                        size="sm"
                        variant={user.isActive ? 'danger' : 'secondary'}
                        title={user.isActive ? 'Désactiver' : 'Réactiver'}
                        disabled={busy}
                        onClick={() =>
                          void send(`/api/users/${user.id}`, {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ isActive: !user.isActive }),
                          })
                        }
                      >
                        {user.isActive ? <UserX size={12} /> : <UserCheck size={12} />}
                      </Button>
                    </div>
                    )
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>

      {canManage && (
        <Panel title="Nouveau compte">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom affiché" htmlFor="u-name">
              <Input
                id="u-name"
                required
                minLength={2}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </Field>
            <Field label="Adresse électronique" htmlFor="u-email">
              <Input
                id="u-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </Field>
            <Field label="Rôle" htmlFor="u-role">
              <Select
                id="u-role"
                value={role}
                onChange={(e) => setRole(e.target.value as UserRow['role'])}
              >
                <option value="DIRECTOR">Réalisateur</option>
                <option value="TECHNICIAN">Technicien</option>
                <option value="ADMIN">Administrateur</option>
              </Select>
            </Field>
            <Field
              label="Mot de passe initial"
              htmlFor="u-pass"
              hint={`${MIN_PASSWORD} caractères minimum.`}
            >
              <Input
                id="u-pass"
                type="password"
                required
                minLength={MIN_PASSWORD}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="primary" disabled={busy} className="sm:col-span-2">
              <Plus size={13} /> Créer le compte
            </Button>
          </form>
        </Panel>
      )}
    </div>
  )
}
