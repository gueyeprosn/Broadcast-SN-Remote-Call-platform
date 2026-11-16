'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PlugZap, Plus } from 'lucide-react'
import { Badge, Button, Field, Input, Notice, Panel, Select } from '@/components/ui'

const BUSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G']

interface Connection {
  id: string
  label: string
  host: string
  port: number
  mode: 'DIRECT' | 'AGENT'
  allowAddInput: boolean
  allowProgramControl: boolean
  returnBuses: string[]
  lastCheckedAt: string | null
  lastStatus: string | null
  vmixVersion: string | null
  vmixEdition: string | null
}

export function VmixAdmin({
  connections,
  canManage,
}: {
  connections: Connection[]
  canManage: boolean
}) {
  const router = useRouter()
  const [label, setLabel] = useState('')
  const [host, setHost] = useState('127.0.0.1')
  const [port, setPort] = useState(8088)
  const [mode, setMode] = useState<'DIRECT' | 'AGENT'>('AGENT')
  const [returnBuses, setReturnBuses] = useState<string[]>(['A'])
  const [allowAddInput, setAllowAddInput] = useState(false)
  const [allowProgramControl, setAllowProgramControl] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function create(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const response = await fetch('/api/vmix/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        label,
        host,
        port,
        mode,
        returnBuses,
        allowAddInput,
        allowProgramControl,
      }),
    })
    setBusy(false)
    if (!response.ok) {
      const data = (await response.json()) as { error?: { message?: string } }
      setError(data.error?.message ?? 'Création refusée.')
      return
    }
    setLabel('')
    router.refresh()
  }

  async function test(id: string) {
    setBusy(true)
    setError(null)
    setResult(null)
    const response = await fetch(`/api/vmix/connections/${id}/test`, { method: 'POST' })
    const data = (await response.json()) as {
      version?: string
      edition?: string
      inputCount?: number
      browserInputCount?: number
      error?: { message?: string }
    }
    setBusy(false)
    if (!response.ok) {
      setError(data.error?.message ?? 'Essai en échec.')
      router.refresh()
      return
    }
    setResult(
      `vMix ${data.version ?? '?'} ${data.edition ?? ''} · ${data.inputCount ?? 0} entrées, ` +
        `${data.browserInputCount ?? 0} de type Web Browser`,
    )
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {error && <Notice tone="crit">{error}</Notice>}
      {result && <Notice tone="ok">{result}</Notice>}

      {connections.length === 0 ? (
        <Panel>
          <p className="text-sm text-txt2">
            Aucune connexion déclarée. L&apos;intégration manuelle (copier le lien vMix
            d&apos;un correspondant dans une entrée Web Browser) fonctionne sans
            connexion : c&apos;est même le chemin le plus sûr.
          </p>
        </Panel>
      ) : (
        connections.map((connection) => (
          <Panel
            key={connection.id}
            title={connection.label}
            actions={
              <div className="flex items-center gap-1.5">
                <Badge tone={connection.mode === 'AGENT' ? 'ok' : 'warn'}>
                  {connection.mode}
                </Badge>
                <Button size="sm" variant="secondary" disabled={busy} onClick={() => void test(connection.id)}>
                  <PlugZap size={12} /> Tester
                </Button>
              </div>
            }
          >
            <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
              <dt className="metric-label">Adresse</dt>
              <dd className="tabular text-txt">
                {connection.host}:{connection.port}
              </dd>
              <dt className="metric-label">Version vMix</dt>
              <dd className="text-txt">
                {connection.vmixVersion ?? '—'} {connection.vmixEdition ?? ''}
              </dd>
              <dt className="metric-label">Dernier essai</dt>
              <dd className="text-txt">
                {connection.lastCheckedAt
                  ? new Date(connection.lastCheckedAt).toLocaleString('fr-FR')
                  : 'jamais'}
              </dd>
              <dt className="metric-label">Bus de retour protégés</dt>
              <dd className="text-txt">
                {connection.returnBuses.length > 0 ? connection.returnBuses.join(', ') : '—'}
              </dd>
              <dt className="metric-label">AddInput autorisé</dt>
              <dd className={connection.allowAddInput ? 'text-warn' : 'text-txt2'}>
                {connection.allowAddInput ? 'oui (non garanti)' : 'non'}
              </dd>
              <dt className="metric-label">Commandes Program</dt>
              <dd className={connection.allowProgramControl ? 'text-warn' : 'text-txt2'}>
                {connection.allowProgramControl ? 'autorisées' : 'bloquées'}
              </dd>
            </dl>
            {connection.lastStatus && connection.lastStatus !== 'ok' && (
              <div className="mt-2">
                <Notice tone="crit" title="Dernier état">
                  {connection.lastStatus}
                </Notice>
              </div>
            )}
          </Panel>
        ))
      )}

      {canManage && (
        <Panel title="Déclarer une connexion">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field label="Nom de la machine" htmlFor="v-label">
              <Input
                id="v-label"
                required
                minLength={2}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Régie studio A"
              />
            </Field>
            <Field label="Mode" htmlFor="v-mode">
              <Select
                id="v-mode"
                value={mode}
                onChange={(e) => setMode(e.target.value as 'DIRECT' | 'AGENT')}
              >
                <option value="AGENT">AGENT — recommandé</option>
                <option value="DIRECT">DIRECT — réseau local uniquement</option>
              </Select>
            </Field>
            <Field
              label="Hôte"
              htmlFor="v-host"
              hint={
                mode === 'DIRECT'
                  ? 'Adresse privée obligatoire (10.x, 172.16–31.x, 192.168.x, 127.x, .local).'
                  : "Adresse de l'agent sur le PC de régie."
              }
            >
              <Input
                id="v-host"
                required
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </Field>
            <Field label="Port" htmlFor="v-port">
              <Input
                id="v-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </Field>

            <fieldset className="sm:col-span-2">
              <legend className="metric-label mb-1">
                Bus déclarés comme bus de retour (protégés contre le rebouclage)
              </legend>
              <div className="flex flex-wrap gap-2">
                {BUSES.map((bus) => (
                  <label key={bus} className="flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      checked={returnBuses.includes(bus)}
                      onChange={(e) =>
                        setReturnBuses((previous) =>
                          e.target.checked
                            ? [...previous, bus]
                            : previous.filter((b) => b !== bus),
                        )
                      }
                      className="accent-[#FF9B26]"
                    />
                    Bus {bus}
                  </label>
                ))}
              </div>
            </fieldset>

            <label className="flex items-start gap-2 text-xs sm:col-span-2">
              <input
                type="checkbox"
                checked={allowAddInput}
                onChange={(e) => setAllowAddInput(e.target.checked)}
                className="mt-0.5 accent-[#FF9B26]"
              />
              <span>
                Autoriser <code className="text-txt">AddInput</code>
                <span className="mt-0.5 block text-txt2">
                  Non documenté pour le type Browser. À n&apos;activer qu&apos;après
                  l&apos;avoir vérifié sur votre installation.
                </span>
              </span>
            </label>

            <label className="flex items-start gap-2 text-xs sm:col-span-2">
              <input
                type="checkbox"
                checked={allowProgramControl}
                onChange={(e) => setAllowProgramControl(e.target.checked)}
                className="mt-0.5 accent-[#FF9B26]"
              />
              <span>
                Autoriser les commandes Program (Cut, Fade, Preview)
                <span className="mt-0.5 block text-txt2">
                  Ces commandes modifient directement ce qui est diffusé.
                </span>
              </span>
            </label>

            <Button type="submit" variant="primary" disabled={busy} className="sm:col-span-2">
              <Plus size={13} /> Déclarer
            </Button>
          </form>
        </Panel>
      )}
    </div>
  )
}
