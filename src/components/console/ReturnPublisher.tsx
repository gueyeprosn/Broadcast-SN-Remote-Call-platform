'use client'

import { useState } from 'react'
import { AudioLines, CircleStop, Play } from 'lucide-react'
import { Badge, Button, Field, Notice, Panel, Select } from '@/components/ui'
import { Brand } from '@/components/Brand'
import { describeMediaError } from '@/components/correspondent/useLocalMedia'

interface Device {
  deviceId: string
  label: string
}

export function ReturnPublisher({
  sessionId,
  sessionName,
  sessionState,
  returnStreamId,
  engineOrigin,
}: {
  sessionId: string
  sessionName: string
  sessionState: 'SCHEDULED' | 'LIVE' | 'ENDED'
  returnStreamId: string
  engineOrigin: string
}) {
  const [audioInputs, setAudioInputs] = useState<Device[]>([])
  const [videoInputs, setVideoInputs] = useState<Device[]>([])
  const [audioDeviceId, setAudioDeviceId] = useState('')
  const [videoDeviceId, setVideoDeviceId] = useState('')
  const [audioOnly, setAudioOnly] = useState(true)
  const [publishUrl, setPublishUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detected, setDetected] = useState(false)

  /**
   * Énumère les périphériques.
   *
   * Déclenché par un clic, jamais au chargement : lire les étiquettes exige une
   * autorisation microphone, et une page qui réclame le micro dès son ouverture
   * est une mauvaise pratique — c'est la même règle que dans la salle de
   * préparation du correspondant. L'accès est relâché immédiatement après.
   */
  async function loadDevices() {
    setError(null)
    setDetecting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      stream.getTracks().forEach((track) => track.stop())
      const devices = await navigator.mediaDevices.enumerateDevices()
      setAudioInputs(
        devices
          .filter((d) => d.kind === 'audioinput' && d.deviceId)
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Entrée audio ${i + 1}` })),
      )
      setVideoInputs(
        devices
          .filter((d) => d.kind === 'videoinput' && d.deviceId)
          .map((d, i) => ({ deviceId: d.deviceId, label: d.label || `Source vidéo ${i + 1}` })),
      )
      setDetected(true)
    } catch (caught) {
      setError(describeMediaError(caught).message)
    } finally {
      setDetecting(false)
    }
  }

  async function start() {
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/sessions/${sessionId}/return-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          audioOnly,
          audioDeviceId: audioDeviceId || undefined,
          videoDeviceId: audioOnly ? undefined : videoDeviceId || undefined,
        }),
      })
      const data = (await response.json()) as { url?: string; error?: { message?: string } }
      if (!response.ok || !data.url) {
        setError(data.error?.message ?? 'Impossible de préparer le retour.')
        return
      }
      setPublishUrl(data.url)
    } catch {
      setError('Le serveur est injoignable.')
    } finally {
      setBusy(false)
    }
  }

  const likelyVirtualCable = (label: string) =>
    /cable|voicemeeter|vb-audio|loopback|blackhole|virtual|ndi|vmix/i.test(label)

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-4">
      <header className="space-y-3">
        <Brand size="md" withSignature />
        <div className="panel flex items-center justify-between gap-3 p-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-txt">{sessionName}</p>
            <p className="font-mono text-2xs text-txt2">
              Bus de retour : {returnStreamId}
            </p>
          </div>
          <Badge tone={publishUrl ? 'ok' : sessionState === 'ENDED' ? 'crit' : 'neutral'}>
            {sessionState === 'ENDED'
              ? 'Session terminée'
              : publishUrl
                ? 'Retour en diffusion'
                : 'Arrêté'}
          </Badge>
        </div>
      </header>

      {sessionState === 'ENDED' ? (
        <Notice tone="crit" title="Session terminée">
          Le retour programme n&apos;est plus nécessaire.
        </Notice>
      ) : (
        <>
          <Notice tone="warn" title="Avant de démarrer">
            <ol className="ml-4 list-decimal space-y-1 text-2xs">
              <li>
                Dans vMix : <em>Settings → Audio Outputs</em>, activez le{' '}
                <strong className="text-txt">Bus A</strong> et dirigez-le vers votre câble
                audio virtuel.
              </li>
              <li>
                Pour chaque entrée de correspondant :{' '}
                <code className="text-txt">AudioBusOff A</code> — sans cela, chacun
                s&apos;entendra lui-même.
              </li>
              <li>
                Ci-dessous, sélectionnez ce <strong className="text-txt">câble virtuel</strong>{' '}
                comme entrée audio, pas le microphone de la machine.
              </li>
            </ol>
          </Notice>

          {error && <Notice tone="crit">{error}</Notice>}

          {!publishUrl && (
            <Panel
              title="Source du retour"
              actions={
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={detecting}
                  onClick={() => void loadDevices()}
                >
                  {detecting ? 'Détection…' : detected ? 'Relire les périphériques' : 'Détecter les périphériques'}
                </Button>
              }
            >
              <div className="space-y-3">
                {!detected && (
                  <Notice tone="neutral">
                    Cliquez sur <strong className="text-txt">Détecter les périphériques</strong>.
                    Lire le nom des entrées audio exige une autorisation microphone, qui
                    n&apos;est donc pas demandée à l&apos;ouverture de la page.
                  </Notice>
                )}
                <Field
                  label="Entrée audio (câble virtuel issu du Bus A)"
                  htmlFor="ret-audio"
                >
                  <Select
                    id="ret-audio"
                    value={audioDeviceId}
                    onChange={(e) => setAudioDeviceId(e.target.value)}
                  >
                    <option value="">Entrée par défaut du système</option>
                    {audioInputs.map((device) => (
                      <option key={device.deviceId} value={device.deviceId}>
                        {likelyVirtualCable(device.label) ? '★ ' : ''}
                        {device.label}
                      </option>
                    ))}
                  </Select>
                </Field>

                <label className="flex items-start gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={audioOnly}
                    onChange={(e) => setAudioOnly(e.target.checked)}
                    className="mt-0.5 accent-[#FF9B26]"
                  />
                  <span>
                    <strong className="text-txt">Retour audio seul</strong>
                    <span className="mt-0.5 block text-txt2">
                      Suffisant dans la plupart des directs. Décochez seulement si une
                      caméra virtuelle (NDI ou Virtual Output vMix) est disponible sur
                      cette machine.
                    </span>
                  </span>
                </label>

                {!audioOnly && (
                  <Field
                    label="Source vidéo (caméra virtuelle NDI / Virtual Output)"
                    htmlFor="ret-video"
                  >
                    <Select
                      id="ret-video"
                      value={videoDeviceId}
                      onChange={(e) => setVideoDeviceId(e.target.value)}
                    >
                      <option value="">Source par défaut</option>
                      {videoInputs.map((device) => (
                        <option key={device.deviceId} value={device.deviceId}>
                          {likelyVirtualCable(device.label) ? '★ ' : ''}
                          {device.label}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}

                <Button
                  variant="primary"
                  className="w-full"
                  disabled={busy}
                  onClick={() => void start()}
                >
                  <Play size={14} /> {busy ? 'Préparation…' : 'Démarrer le retour'}
                </Button>
                <p className="text-2xs text-txt2">
                  Le traitement d&apos;écho, la réduction de bruit et
                  l&apos;auto-nivellement sont désactivés sur ce flux : ces traitements
                  sont faits pour une voix au micro, pas pour un mixage d&apos;émission.
                </p>
              </div>
            </Panel>
          )}

          {publishUrl && (
            <>
              <Panel
                title="Retour en diffusion"
                bodyClassName="p-0"
                actions={
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => {
                      if (window.confirm('Arrêter le retour programme ?')) setPublishUrl(null)
                    }}
                  >
                    <CircleStop size={12} /> Arrêter
                  </Button>
                }
              >
                <iframe
                  src={publishUrl}
                  title="Publication du retour programme"
                  allow="camera; microphone; autoplay"
                  className="h-64 w-full border-0 bg-black"
                />
              </Panel>
              <Notice tone="ok" title="Ne fermez pas cet onglet">
                <p className="flex items-start gap-1.5 text-2xs">
                  <AudioLines size={12} className="mt-0.5 shrink-0" />
                  Ce navigateur est la source du retour entendu par tous les
                  correspondants. Fermer l&apos;onglet coupe leur retour, sans affecter
                  l&apos;antenne. Origine du moteur : {engineOrigin}
                </p>
              </Notice>
            </>
          )}
        </>
      )}
    </main>
  )
}
