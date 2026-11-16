'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { KeyRound } from 'lucide-react'
import { Button, Field, Input, Notice } from '@/components/ui'

const MIN_PASSWORD = 12

export function SelfPasswordForm() {
  const router = useRouter()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Vérifié avant l'envoi : inutile de faire voyager un mot de passe mal saisi.
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD
  const mismatch = confirm.length > 0 && next !== confirm
  const identical = next.length > 0 && next === current
  const ready =
    current.length > 0 && next.length >= MIN_PASSWORD && next === confirm && !identical

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!ready) return
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      const response = await fetch('/api/account/password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      })
      const data = (await response.json()) as {
        message?: string
        error?: { message?: string }
      }
      if (!response.ok) {
        setError(data.error?.message ?? 'Changement refusé.')
        return
      }
      setDone(data.message ?? 'Mot de passe modifié.')
      setCurrent('')
      setNext('')
      setConfirm('')
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
      {done && <Notice tone="ok">{done}</Notice>}

      <Field label="Mot de passe actuel" htmlFor="pw-current">
        <Input
          id="pw-current"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
      </Field>

      <Field
        label="Nouveau mot de passe"
        htmlFor="pw-new"
        hint={`${MIN_PASSWORD} caractères minimum.`}
        error={
          tooShort
            ? `Trop court : ${MIN_PASSWORD} caractères minimum.`
            : identical
              ? 'Le nouveau mot de passe doit être différent de l’actuel.'
              : null
        }
      >
        <Input
          id="pw-new"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
      </Field>

      <Field
        label="Confirmation"
        htmlFor="pw-confirm"
        error={mismatch ? 'Les deux saisies diffèrent.' : null}
      >
        <Input
          id="pw-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </Field>

      <Button type="submit" variant="primary" className="w-full" disabled={!ready || busy}>
        <KeyRound size={13} /> {busy ? 'Modification…' : 'Changer mon mot de passe'}
      </Button>

      <p className="text-2xs text-txt2">
        Vos autres sessions seront déconnectées immédiatement. Celle-ci reste
        ouverte : vous n&apos;aurez pas à vous reconnecter ici.
      </p>
    </form>
  )
}
