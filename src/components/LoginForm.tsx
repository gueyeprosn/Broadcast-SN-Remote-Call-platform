'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, Input, Notice } from '@/components/ui'

export function LoginForm() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      })
      const data = (await response.json()) as { error?: { message?: string } }
      if (!response.ok) {
        setError(data.error?.message ?? 'Connexion refusée.')
        return
      }
      router.replace('/productions')
      router.refresh()
    } catch {
      setError('Le serveur est injoignable.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Notice tone="crit">{error}</Notice>}
      <Field label="Adresse électronique" htmlFor="email">
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </Field>
      <Field label="Mot de passe" htmlFor="password">
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </Field>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? 'Vérification…' : 'Se connecter'}
      </Button>
    </form>
  )
}
