'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Archive, ArchiveRestore, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui'

/**
 * Ranger ou supprimer une émission.
 *
 * Deux opérations volontairement distinctes :
 *  - **Archiver** sort l'émission de la liste et conserve tout. Réversible.
 *  - **Supprimer** n'est proposé que pour une émission qui n'a jamais porté
 *    d'édition — le cas « créée par erreur ». Dès qu'une édition a existé, le
 *    bouton n'apparaît pas : le serveur refuserait de toute façon, mais mieux
 *    vaut ne pas proposer ce qu'on va refuser.
 */
export function ProductionActions({
  productionId,
  name,
  sessionCount,
  archived,
}: {
  productionId: string
  name: string
  sessionCount: number
  archived: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function send(init: RequestInit) {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/productions/${productionId}`, init)
      if (!response.ok) {
        const data = (await response.json()) as { error?: { message?: string } }
        setError(data.error?.message ?? 'Action refusée.')
        return
      }
      router.refresh()
    } catch {
      setError('Le serveur est injoignable.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-1.5">
      {error && <span className="text-2xs text-crit">{error}</span>}

      {archived ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          title="Remettre cette émission dans la liste"
          onClick={() =>
            void send({
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ isArchived: false }),
            })
          }
        >
          <ArchiveRestore size={12} /> Réactiver
        </Button>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          title="Sortir cette émission de la liste, sans rien perdre"
          onClick={() =>
            void send({
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ isArchived: true }),
            })
          }
        >
          <Archive size={12} /> Archiver
        </Button>
      )}

      {sessionCount === 0 && (
        <Button
          size="sm"
          variant="danger"
          disabled={busy}
          title="Supprimer définitivement — possible car aucune édition n’existe"
          onClick={() => {
            if (
              !window.confirm(
                `Supprimer définitivement « ${name} » ?\n\n` +
                  'Elle ne porte aucune édition, rien d’autre ne sera perdu. ' +
                  'Cette action est irréversible.',
              )
            ) {
              return
            }
            void send({ method: 'DELETE' })
          }}
        >
          <Trash2 size={12} />
        </Button>
      )}
    </div>
  )
}
