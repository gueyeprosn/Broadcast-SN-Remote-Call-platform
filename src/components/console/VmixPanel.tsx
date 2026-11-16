'use client'

import { useCallback, useState } from 'react'
import { PlugZap, RefreshCw, Volume, VolumeX } from 'lucide-react'
import { Badge, Button, Notice, Panel, Select } from '@/components/ui'
import type { ParticipantSummary, VmixConnectionSummary } from './types'

interface VmixInputRow {
  key: string
  number: number | null
  type: string | null
  title: string
  isBrowser: boolean
}

export function VmixPanel({
  connections,
  participants,
  selectedConnectionId,
  onSelectConnection,
  syncEnabled,
  onToggleSync,
  canNavigate,
  canAudio,
  onChanged,
}: {
  sessionId: string
  connections: VmixConnectionSummary[]
  participants: ParticipantSummary[]
  selectedConnectionId: string | null
  onSelectConnection: (id: string | null) => void
  syncEnabled: boolean
  onToggleSync: (enabled: boolean) => void
  canNavigate: boolean
  canAudio: boolean
  onChanged: () => void
}) {
  const [inputs, setInputs] = useState<VmixInputRow[] | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const connection = connections.find((c) => c.id === selectedConnectionId) ?? null

  const call = useCallback(
    async (path: string, init: RequestInit): Promise<unknown | null> => {
      setBusy(true)
      setError(null)
      try {
        const response = await fetch(path, init)
        const data = (await response.json()) as { error?: { message?: string } }
        if (!response.ok) {
          setError(data.error?.message ?? 'vMix a refusé la commande.')
          return null
        }
        return data
      } catch {
        setError("L'agent vMix est injoignable.")
        return null
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  async function test() {
    if (!connection) return
    const data = (await call(`/api/vmix/connections/${connection.id}/test`, {
      method: 'POST',
    })) as { version?: string; edition?: string; inputCount?: number; browserInputCount?: number } | null
    if (data) {
      setStatus(
        `vMix ${data.version ?? '?'} ${data.edition ?? ''} · ${data.inputCount ?? 0} entrées ` +
          `(dont ${data.browserInputCount ?? 0} Web Browser)`,
      )
      onChanged()
    }
  }

  async function loadInputs() {
    if (!connection) return
    const data = (await call(`/api/vmix/connections/${connection.id}/inputs`, {
      method: 'GET',
    })) as { inputs?: VmixInputRow[] } | null
    if (data?.inputs) setInputs(data.inputs)
  }

  async function assign(participantId: string, inputKey: string) {
    if (!connection || !inputKey) return
    const result = (await call(`/api/vmix/connections/${connection.id}/map`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId, inputKey }),
    })) as { displaced?: { displayName: string } | null } | null
    if (!result) return
    // Une entrée ne sert qu'un correspondant : si elle était déjà prise, on le
    // dit plutôt que de laisser l'opérateur le découvrir à l'antenne.
    setStatus(
      result.displaced
        ? `Entrée réaffectée. ${result.displaced.displayName} n'a plus d'entrée vMix.`
        : 'Entrée associée.',
    )
    onChanged()
  }

  async function audio(participantId: string, action: 'AudioOn' | 'AudioOff') {
    if (!connection) return
    await call(`/api/vmix/connections/${connection.id}/map`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ participantId, action }),
    })
  }

  if (connections.length === 0) {
    return (
      <Panel title="vMix">
        <Notice tone="neutral">
          Aucune connexion vMix déclarée. Les liens vMix restent utilisables : copiez-les
          depuis la carte d&apos;un correspondant et créez une entrée{' '}
          <strong className="text-txt">Web Browser</strong> dans vMix. C&apos;est le
          chemin documenté et garanti.
        </Notice>
      </Panel>
    )
  }

  return (
    <Panel
      title="vMix"
      actions={
        <label className="flex items-center gap-1.5 text-2xs text-txt2">
          <input
            type="checkbox"
            checked={syncEnabled}
            onChange={(e) => onToggleSync(e.target.checked)}
            className="accent-[#FF9B26]"
          />
          ON AIR depuis vMix
        </label>
      }
    >
      <div className="space-y-2.5">
        {error && <Notice tone="crit">{error}</Notice>}

        <Select
          aria-label="Connexion vMix"
          className="h-8 py-0 text-xs"
          value={selectedConnectionId ?? ''}
          onChange={(e) => {
            onSelectConnection(e.target.value || null)
            setInputs(null)
            setStatus(null)
          }}
        >
          {connections.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label} · {c.host}:{c.port} · {c.mode}
            </option>
          ))}
        </Select>

        <div className="flex items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={() => void test()} disabled={busy}>
            <PlugZap size={12} /> Tester
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void loadInputs()} disabled={busy}>
            <RefreshCw size={12} /> Entrées
          </Button>
          {connection?.lastStatus && (
            <Badge tone={connection.lastStatus === 'ok' ? 'ok' : 'crit'}>
              {connection.lastStatus === 'ok' ? 'Joignable' : 'Erreur'}
            </Badge>
          )}
        </div>

        {status && <p className="text-2xs text-txt2">{status}</p>}

        {connection?.lastStatus && connection.lastStatus !== 'ok' && (
          <Notice tone="crit" title="Dernier essai en échec">
            {connection.lastStatus}
          </Notice>
        )}

        {inputs && (
          <div className="space-y-1.5">
            <p className="metric-label">Association correspondant → entrée</p>
            {inputs.filter((i) => i.isBrowser).length === 0 && (
              <Notice tone="warn">
                Aucune entrée de type Web Browser dans vMix. Créez-en une
                (<em>Add Input → More → Web Browser</em>) puis rechargez cette liste.
                Créer une entrée navigateur par l&apos;API n&apos;est pas documenté et
                n&apos;est donc pas proposé ici.
              </Notice>
            )}
            {participants
              .filter((p) => p.state !== 'REVOKED')
              .map((participant) => (
                <div key={participant.id} className="flex items-center gap-1.5">
                  <span className="w-24 shrink-0 truncate text-2xs text-txt">
                    {participant.displayName}
                  </span>
                  <Select
                    aria-label={`Entrée vMix pour ${participant.displayName}`}
                    className="h-7 py-0 text-2xs"
                    value={participant.mapping?.inputKey ?? ''}
                    disabled={!canNavigate || busy}
                    onChange={(e) => void assign(participant.id, e.target.value)}
                  >
                    <option value="">— non associé —</option>
                    {inputs
                      .filter((i) => i.isBrowser)
                      .map((input) => (
                        <option key={input.key} value={input.key}>
                          {input.number ?? '?'} · {input.title}
                        </option>
                      ))}
                  </Select>
                  {canAudio && participant.mapping && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="AudioOn — réactive l’entrée dans vMix"
                        onClick={() => void audio(participant.id, 'AudioOn')}
                      >
                        <Volume size={11} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        title="AudioOff — coupe l’entrée DANS vMix ; le correspondant continue d’émettre"
                        onClick={() => void audio(participant.id, 'AudioOff')}
                      >
                        <VolumeX size={11} />
                      </Button>
                    </>
                  )}
                </div>
              ))}
          </div>
        )}

        <p className="border-t border-line/50 pt-2 text-2xs text-txt2">
          <strong className="text-txt">AudioOff</strong> coupe le son de l&apos;entrée{' '}
          <em>dans vMix</em>. Le correspondant, lui, continue d&apos;émettre et ne le voit
          pas. Pour couper réellement son micro, utilisez le bouton Micro de sa carte.
        </p>
      </div>
    </Panel>
  )
}
