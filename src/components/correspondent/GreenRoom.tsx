'use client'

import { useState } from 'react'
import {
  Activity,
  Camera,
  Headphones,
  Mic,
  ShieldCheck,
  TriangleAlert,
  Video,
} from 'lucide-react'
import { Badge, Button, Field, Notice, Select } from '@/components/ui'
import { Brand } from '@/components/Brand'
import { cn } from '@/lib/cn'
import {
  testConnectivity,
  useLocalMedia,
  type ConnectivityResult,
} from './useLocalMedia'
import type { QualityProfile, QualityProfileId } from '@/lib/media/engine'

export function GreenRoom({
  productionName,
  sessionName,
  displayName,
  profiles,
  profile,
  onProfileChange,
  stunUrls,
  joining,
  joinError,
  onJoin,
}: {
  productionName: string
  sessionName: string
  displayName: string
  profiles: QualityProfile[]
  profile: QualityProfileId
  onProfileChange: (profile: QualityProfileId) => void
  stunUrls: string[]
  joining: boolean
  joinError: string | null
  onJoin: (devices: { videoDeviceId?: string; audioDeviceId?: string }) => void
}) {
  const { state: devices, videoRef, open, release, selectSpeaker } = useLocalMedia()
  const [connectivity, setConnectivity] = useState<ConnectivityResult | null>(null)
  const [testing, setTesting] = useState(false)
  const [headphonesConfirmed, setHeadphonesConfirmed] = useState(false)

  const ready = devices.phase === 'granted'
  const selectedProfile = profiles.find((p) => p.id === profile) ?? profiles[0]

  async function runConnectivityTest() {
    setTesting(true)
    try {
      setConnectivity(await testConnectivity(stunUrls))
    } finally {
      setTesting(false)
    }
  }

  function join() {
    // Les périphériques sont libérés AVANT que le moteur média ne les ouvre :
    // sinon la caméra est « déjà utilisée » et l'entrée en salle échoue.
    const videoDeviceId = devices.selectedCamera ?? undefined
    const audioDeviceId = devices.selectedMicrophone ?? undefined
    release()
    onJoin({
      ...(videoDeviceId ? { videoDeviceId } : {}),
      ...(audioDeviceId ? { audioDeviceId } : {}),
    })
  }

  return (
    <main className="mx-auto w-full max-w-3xl space-y-4 p-4 pb-16">
      <header className="space-y-3">
        <Brand size="md" withSignature />
        <div className="panel p-3">
          <p className="text-2xs uppercase tracking-[0.12em] text-txt2">Émission</p>
          <p className="text-base font-semibold text-txt">{productionName}</p>
          <p className="text-xs text-txt2">{sessionName}</p>
          <p className="mt-2 border-t border-line/60 pt-2 text-xs text-txt2">
            Vous êtes connecté en tant que{' '}
            <strong className="text-txt">{displayName}</strong>
          </p>
        </div>
      </header>

      {/* ── Aperçu ─────────────────────────────────────────────────────────── */}
      <section className="panel overflow-hidden">
        <div className="relative aspect-video w-full bg-black">
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className={cn('h-full w-full object-cover', !ready && 'opacity-0')}
          />
          {!ready && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
              <Video size={28} className="text-txt2" />
              <p className="text-sm text-txt2">
                Nous avons besoin de votre caméra et de votre microphone.
              </p>
              <Button
                variant="primary"
                disabled={devices.phase === 'requesting'}
                onClick={() => void open()}
              >
                {devices.phase === 'requesting'
                  ? 'Demande en cours…'
                  : 'Autoriser la caméra et le micro'}
              </Button>
              <p className="max-w-sm text-2xs text-txt2">
                Votre navigateur va afficher une demande d&apos;autorisation. Rien
                n&apos;est diffusé à ce stade : vous n&apos;êtes pas encore en liaison
                avec la régie.
              </p>
            </div>
          )}
        </div>

        {devices.error && (
          <div className="p-3">
            <Notice tone="crit" title="Périphérique indisponible">
              <p>{devices.error.message}</p>
              <p className="mt-1 font-mono text-2xs opacity-70">
                Code technique : {devices.error.name}
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                onClick={() => void open()}
              >
                Réessayer
              </Button>
            </Notice>
          </div>
        )}
      </section>

      {ready && (
        <>
          {/* ── Périphériques ─────────────────────────────────────────────── */}
          <section className="panel space-y-3 p-3">
            <h2 className="panel-title">Périphériques</h2>

            <Field label="Caméra" htmlFor="cam">
              <Select
                id="cam"
                value={devices.selectedCamera ?? ''}
                onChange={(e) =>
                  void open(e.target.value, devices.selectedMicrophone)
                }
              >
                {devices.cameras.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Microphone" htmlFor="mic">
              <Select
                id="mic"
                value={devices.selectedMicrophone ?? ''}
                onChange={(e) =>
                  void open(devices.selectedCamera, e.target.value)
                }
              >
                {devices.microphones.map((device) => (
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label}
                  </option>
                ))}
              </Select>
            </Field>

            {/* Affiché seulement si le navigateur sait réellement le faire. */}
            {devices.canChooseSpeaker && devices.speakers.length > 0 && (
              <Field
                label="Sortie audio"
                htmlFor="spk"
                hint="Choisissez votre casque pour entendre la régie."
              >
                <Select
                  id="spk"
                  value={devices.selectedSpeaker ?? ''}
                  onChange={(e) => selectSpeaker(e.target.value)}
                >
                  <option value="">Sortie par défaut du système</option>
                  {devices.speakers.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {!devices.canChooseSpeaker && (
              <p className="flex gap-1.5 text-2xs text-txt2">
                <Headphones size={12} className="mt-0.5 shrink-0" />
                Votre navigateur ne permet pas de choisir la sortie audio depuis cette
                page. Sélectionnez votre casque dans les réglages de votre appareil.
              </p>
            )}

            {/* ── Test micro ──────────────────────────────────────────────── */}
            <div className="space-y-1.5 border-t border-line/60 pt-3">
              <div className="flex items-center justify-between">
                <span className="metric-label">Test du microphone — parlez</span>
                <Badge
                  tone={
                    devices.micLevel === null
                      ? 'neutral'
                      : devices.micLevel > 0.04
                        ? 'ok'
                        : 'warn'
                  }
                >
                  {devices.micLevel === null
                    ? 'non mesuré'
                    : devices.micLevel > 0.04
                      ? 'signal détecté'
                      : 'silence'}
                </Badge>
              </div>
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-bg">
                {devices.micLevel !== null && (
                  <div
                    className={cn(
                      'h-full transition-[width] duration-75',
                      devices.micLevel > 0.85
                        ? 'bg-crit'
                        : devices.micLevel > 0.6
                          ? 'bg-warn'
                          : 'bg-ok',
                    )}
                    style={{ width: `${Math.round(devices.micLevel * 100)}%` }}
                  />
                )}
              </div>
            </div>
          </section>

          {/* ── Qualité ───────────────────────────────────────────────────── */}
          <section className="panel space-y-2 p-3">
            <h2 className="panel-title">Qualité d&apos;émission</h2>
            <Select
              aria-label="Profil de qualité"
              value={profile}
              onChange={(e) => onProfileChange(e.target.value as QualityProfileId)}
            >
              {profiles.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
            {selectedProfile && (
              <p className="text-2xs text-txt2">
                {selectedProfile.note} Cible : {selectedProfile.targetWidth}×
                {selectedProfile.targetHeight}, {selectedProfile.videoBitrateKbps} kb/s
                vidéo. La valeur réellement atteinte est mesurée par la régie et peut
                être plus basse selon votre réseau.
              </p>
            )}
          </section>

          {/* ── Test de connexion ─────────────────────────────────────────── */}
          <section className="panel space-y-2 p-3">
            <div className="flex items-center justify-between">
              <h2 className="panel-title">Test de connexion</h2>
              <Button size="sm" variant="secondary" disabled={testing} onClick={() => void runConnectivityTest()}>
                <Activity size={12} /> {testing ? 'Test…' : 'Lancer le test'}
              </Button>
            </div>
            {connectivity ? (
              <Notice
                tone={
                  connectivity.verdict === 'ok'
                    ? 'ok'
                    : connectivity.verdict === 'risky'
                      ? 'warn'
                      : 'crit'
                }
              >
                <p>{connectivity.summary}</p>
                <p className="mt-1 font-mono text-2xs opacity-70">
                  local {connectivity.host ? '✓' : '✗'} · public{' '}
                  {connectivity.srflx ? '✓' : '✗'} · relais{' '}
                  {connectivity.relay ? '✓' : '✗'}
                </p>
              </Notice>
            ) : (
              <p className="text-2xs text-txt2">
                Vérifie que votre réseau laisse passer un flux temps réel. Recommandé
                avant chaque direct depuis un lieu nouveau.
              </p>
            )}
          </section>

          {/* ── Casque obligatoire ────────────────────────────────────────── */}
          <section className="panel p-3">
            <label className="flex cursor-pointer items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={headphonesConfirmed}
                onChange={(e) => setHeadphonesConfirmed(e.target.checked)}
                className="mt-0.5 accent-[#FF9B26]"
              />
              <span>
                <strong className="text-txt">Je porte un casque ou des oreillettes.</strong>
                <span className="mt-0.5 block text-txt2">
                  Sans casque, le retour de la régie repart dans votre micro et crée un
                  écho à l&apos;antenne. C&apos;est la cause numéro un de problème audio
                  en direct.
                </span>
              </span>
            </label>
          </section>

          {joinError && <Notice tone="crit" title="Entrée en salle impossible">{joinError}</Notice>}

          <div className="sticky bottom-0 -mx-4 border-t border-line/70 bg-bg/95 p-4 backdrop-blur">
            <Button
              variant="primary"
              className="h-12 w-full text-base"
              disabled={!ready || !headphonesConfirmed || joining}
              onClick={join}
            >
              {joining ? 'Connexion à la régie…' : 'Rejoindre la régie'}
            </Button>
            <p className="mt-2 flex items-center justify-center gap-1.5 text-2xs text-txt2">
              {headphonesConfirmed ? (
                <>
                  <ShieldCheck size={12} /> Prêt. Vous ne serez à l&apos;antenne que
                  lorsque la régie le décidera.
                </>
              ) : (
                <>
                  <TriangleAlert size={12} className="text-warn" /> Confirmez le port
                  d&apos;un casque pour continuer.
                </>
              )}
            </p>
          </div>
        </>
      )}

      {!ready && devices.phase === 'idle' && (
        <section className="panel space-y-2 p-3 text-2xs text-txt2">
          <p className="flex gap-1.5">
            <Camera size={12} className="mt-0.5 shrink-0" />
            Sur iPhone et iPad, utilisez <strong className="text-txt">Safari</strong>.
          </p>
          <p className="flex gap-1.5">
            <Mic size={12} className="mt-0.5 shrink-0" />
            Sur Android, utilisez <strong className="text-txt">Chrome</strong>.
          </p>
          <p className="flex gap-1.5">
            <Headphones size={12} className="mt-0.5 shrink-0" />
            Branchez votre casque <em>avant</em> d&apos;autoriser le microphone.
          </p>
        </section>
      )}
    </main>
  )
}
