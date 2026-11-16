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
      <Button type="submit" variant="primary" className="w-full" disabled={busy}>
        {busy ? 'Création…' : 'Créer la production'}
      </Button>
    </form>
  )
}
