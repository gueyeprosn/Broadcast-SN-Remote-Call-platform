'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Copy, Link2, UserPlus } from 'lucide-react'
import { Badge, Button, Field, Input, Notice, Panel, Select } from '@/components/ui'
import type { ParticipantSummary } from './types'
import type { QualityProfile } from '@/lib/media/engine'

interface Issued {
  participantId: string
  url: string
  expiresAt: string
  maxUses: number
}

export function InvitePanel({
  sessionId,
  participants,
  canInvite,
  canAdd,
  qualityProfiles,
  onChanged,
  canRemove,
  onRemove,
}: {
  sessionId: string
  participants: ParticipantSummary[]
  canInvite: boolean
  canAdd: boolean
  qualityProfiles: QualityProfile[]
  onChanged: () => void
  canRemove: boolean
  onRemove: (participant: ParticipantSummary) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [profile, setProfile] = useState('BROADCAST')
  const [ttl, setTtl] = useState(720)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [issued, setIssued] = useState<Issued | null>(null)
  const [copied, setCopied] = useState(false)
  const issuedInputRef = useRef<HTMLInputElement | null>(null)

  // Un lien fraîchement généré doit être vu. On l'amène à l'écran et on le
  // sélectionne : le réalisateur n'a plus qu'à copier, et surtout il constate
  // que quelque chose s'est passé.
  useEffect(() => {
    if (!issued) return
    const input = issuedInputRef.current
    if (!input) return
    input.scrollIntoView({ behavior: 'smooth', block: 'center' })
    input.focus({ preventScroll: true })
    input.select()
  }, [issued])

  async function addParticipant(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const response = await fetch(`/api/sessions/${sessionId}/participants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: name.trim(), qualityProfile: profile }),
    })
    setBusy(false)
    if (!response.ok) {
      const data = (await response.json()) as { error?: { message?: string } }
      setError(data.error?.message ?? 'Ajout refusé.')
      return
    }
    setName('')
    onChanged()
  }

  async function issueLink(participantId: string) {
    setBusy(true)
    setError(null)
    setIssued(null)
    const response = await fetch(`/api/sessions/${sessionId}/invitations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId, ttlMinutes: ttl }),
    })
    setBusy(false)
    if (!response.ok) {
      const data = (await response.json()) as { error?: { message?: string } }
      setError(data.error?.message ?? 'Génération refusée.')
      return
    }
    const data = (await response.json()) as {
      invitation: { url: string; expiresAt: string; maxUses: number }
    }
    setIssued({
      participantId,
      url: data.invitation.url,
      expiresAt: data.invitation.expiresAt,
      maxUses: data.invitation.maxUses,
    })
    onChanged()
  }

  return (
    <Panel title="Invitations">
      <div className="space-y-3">
        {error && <Notice tone="crit">{error}</Notice>}

        {/* Le lien généré est placé EN TÊTE du panneau, pas en bas de la liste.
            C'est un secret affiché une seule fois : s'il apparaît sous la ligne de
            flottaison, le réalisateur clique, ne voit rien bouger, et conclut
            qu'il n'y a pas de lien. Il est aussi amené à l'écran et sélectionné
            automatiquement. */}
        {issued && (
          <Notice tone="warn" title="Lien d’invitation — affiché une seule fois">
            <p className="mb-2 text-2xs">
              Pour{' '}
              <strong className="text-txt">
                {participants.find((p) => p.id === issued.participantId)?.displayName ??
                  'ce correspondant'}
              </strong>
              . Ce lien n&apos;est pas stocké en clair : si vous le perdez, générez-en
              un nouveau. Expire le {new Date(issued.expiresAt).toLocaleString('fr-FR')}{' '}
              · {issued.maxUses} ouvertures maximum.
            </p>
            <div className="flex gap-1.5">
              <input
                ref={issuedInputRef}
                readOnly
                aria-label="Lien d’invitation à envoyer au correspondant"
                value={issued.url}
                onFocus={(e) => e.currentTarget.select()}
                className="w-full rounded border border-line bg-bg px-2 py-1 font-mono text-2xs"
              />
              <Button
                size="sm"
                variant="primary"
                className="shrink-0"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(issued.url)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1800)
                  } catch {
                    // Le presse-papiers peut être refusé : on offre alors une
                    // sélection manuelle plutôt que d'échouer en silence.
                    window.prompt('Copiez ce lien :', issued.url)
                  }
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copié' : 'Copier'}
              </Button>
            </div>
          </Notice>
        )}

        {canAdd && (
          <form onSubmit={addParticipant} className="space-y-2">
            <div className="flex gap-1.5">
              <Input
                aria-label="Nom du correspondant"
                placeholder="Nom du correspondant"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={60}
                className="h-8 py-0 text-xs"
              />
              <Button
                type="submit"
                size="sm"
                variant="secondary"
                aria-label="Ajouter le correspondant"
                disabled={busy || name.trim().length < 2}
              >
                <UserPlus size={12} /> Ajouter
              </Button>
            </div>
            <Select
              aria-label="Profil qualité"
              className="h-8 py-0 text-xs"
              value={profile}
              onChange={(e) => setProfile(e.target.value)}
            >
              {qualityProfiles.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </form>
        )}

        {canInvite && (
          <Field
            label="Durée de validité du lien"
            htmlFor="ttl"
            hint="Au-delà, le lien cesse de fonctionner."
          >
            <Select
              id="ttl"
              className="h-8 py-0 text-xs"
              value={ttl}
              onChange={(e) => setTtl(Number(e.target.value))}
            >
              <option value={60}>1 heure</option>
              <option value={240}>4 heures</option>
              <option value={720}>12 heures</option>
              <option value={1440}>24 heures</option>
              <option value={4320}>3 jours</option>
            </Select>
          </Field>
        )}

        <ul className="space-y-1.5">
          {participants.filter((participant) => participant.state !== 'REVOKED').map((participant) => (
            <li
              key={participant.id}
              className="flex items-center justify-between gap-2 rounded border border-line/60 bg-surface2/50 px-2 py-1.5"
            >
              <span className="min-w-0">
                <span className="block truncate text-xs text-txt">
                  {participant.displayName}
                </span>
                <span className="block font-mono text-2xs text-txt2">
                  {participant.streamId}
                </span>
              </span>
              {participant.state === 'REVOKED' ? (
                <Badge tone="crit">Révoqué</Badge>
              ) : (
                canInvite && (
                  // `secondary` et non `ghost` : c'est l'action principale de la
                  // ligne. Un bouton fantôme à côté d'un « Retirer » rouge se lit
                  // comme un libellé, pas comme quelque chose à cliquer.
                  <Button
                    size="sm"
                    variant="secondary"
                    className="shrink-0"
                    disabled={busy}
                    onClick={() => void issueLink(participant.id)}
                    title="Générer un lien d’invitation à envoyer au correspondant"
                  >
                    <Link2 size={12} />
                    {issued?.participantId === participant.id
                      ? 'Nouveau lien'
                      : "Lien d’invitation"}
                  </Button>
                )
              )}
              {canRemove && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={async () => {
                    if (!window.confirm(`Retirer ${participant.displayName} ? Son accès et ses invitations seront révoqués.`)) return
                    setBusy(true)
                    setError(null)
                    try {
                      await onRemove(participant)
                      if (issued?.participantId === participant.id) setIssued(null)
                    } catch (caught) {
                      setError(caught instanceof Error ? caught.message : 'Retrait impossible.')
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  Retirer
                </Button>
              )}
            </li>
          ))}
        </ul>

      </div>
    </Panel>
  )
}
