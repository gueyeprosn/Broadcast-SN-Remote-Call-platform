'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { Button, Input } from '@/components/ui'

export function NewSessionForm({
  productionId,
  suggestion,
}: {
  productionId: string
  /**
   * Nom proposé, calculé à la date du jour **par le serveur** et transmis ici.
   * Le calculer dans ce composant produirait une chaîne au rendu serveur et une
   * autre à l'hydratation dès que les fuseaux diffèrent ou qu'on franchit
   * minuit. Une date écrite en dur, elle, se périme le lendemain.
   */
  suggestion: string
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (name.trim().length < 2) return
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/productions/${productionId}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.trim() }),
    })
    setBusy(false)
    if (!response.ok) {
      const data = (await response.json()) as { error?: { message?: string } }
      setError(data.error?.message ?? 'Création refusée.')
      return
    }
    const data = (await response.json()) as { session: { id: string } }
    router.push(`/control/${data.session.id}`)
  }

  return (
    <form onSubmit={submit} className="space-y-2">
      <div className="flex gap-2">
        <Input
          aria-label="Nom de la session"
          placeholder={suggestion}
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
        />
        <Button type="submit" variant="secondary" disabled={busy || name.trim().length < 2}>
          <Plus size={13} /> Session
        </Button>
      </div>
      {error && <p className="text-xs text-crit">{error}</p>}
    </form>
  )
}
