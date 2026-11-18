'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Field, Input, Notice, Select } from '@/components/ui'
import { QUALITY_PROFILES } from '@/lib/media/engine'

export function NewProductionForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [profile, setProfile] = useState('BROADCAST')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const response = await fetch('/api/productions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: description || undefined,
        defaultQualityProfile: profile,
      }),
    })
    setBusy(false)
    if (!response.ok) {
      const data = (await response.json()) as { error?: { message?: string } }
      setError(data.error?.message ?? 'Création refusée.')
      return
    }
    setName('')
    setDescription('')

    // On repart vers la liste en désignant l'émission créée : la page la met en
    // évidence et l'amène à l'écran. Un simple `refresh()` laissait l'écran
    // identique — l'émission apparaissait en tête de liste pendant que
    // l'utilisateur regardait le formulaire, et rien ne signalait le succès.
    const data = (await response.json()) as { production?: { id?: string } }
    const id = data.production?.id
    router.push(id ? `/productions?nouvelle=${encodeURIComponent(id)}` : '/productions')
    router.refresh()
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Notice tone="crit">{error}</Notice>}
      <Field label="Nom de l'émission" htmlFor="prod-name">
        <Input
          id="prod-name"
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Journal de 20h"
        />
      </Field>
      <details className="rounded-md border border-line p-3">
      <summary className="cursor-pointer text-sm text-txt2">Options de l’émission</summary>
      <div className="mt-3 space-y-3">
      <Field label="Description" htmlFor="prod-desc">
        <Input
          id="prod-desc"
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      <Field
        label="Profil qualité par défaut"
        htmlFor="prod-profile"
        hint="Proposé aux correspondants ; modifiable par correspondant."
      >
        <Select
          id="prod-profile"
          value={profile}
          onChange={(e) => setProfile(e.target.value)}
        >
          {Object.values(QUALITY_PROFILES).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </Select>
      </Field>
      </div>
      </details>
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? 'Création…' : 'Créer l’émission'}
      </Button>
    </form>
  )
}
