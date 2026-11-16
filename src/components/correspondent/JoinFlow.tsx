'use client'

import { useState } from 'react'
import { GreenRoom } from './GreenRoom'
import { LiveCall, type JoinPayload } from './LiveCall'
import type { QualityProfile, QualityProfileId } from '@/lib/media/engine'

type Phase = 'greenroom' | 'live' | 'left'

export function JoinFlow({
  token,
  productionName,
  sessionName,
  displayName,
  defaultProfile,
  profiles,
  stunUrls,
}: {
  token: string
  productionName: string
  sessionName: string
  displayName: string
  defaultProfile: string
  profiles: QualityProfile[]
  stunUrls: string[]
}) {
  const [phase, setPhase] = useState<Phase>('greenroom')
  const [profile, setProfile] = useState<QualityProfileId>(
    (defaultProfile as QualityProfileId) ?? 'BROADCAST',
  )
  const [payload, setPayload] = useState<JoinPayload | null>(null)
  const [joining, setJoining] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function join(devices: { videoDeviceId?: string; audioDeviceId?: string }) {
    setJoining(true)
    setError(null)
    try {
      // 1. Échange du jeton contre un cookie de participant. C'est ici — et
      //    seulement ici — qu'une utilisation du lien est consommée.
      const accept = await fetch(`/api/invite/${encodeURIComponent(token)}`, {
        method: 'POST',
      })
      if (!accept.ok) {
        const data = (await accept.json()) as { error?: { message?: string } }
        setError(data.error?.message ?? 'Ce lien n’est plus valable.')
        return
      }

      // 2. Le serveur construit les URL du moteur. Jamais le navigateur : sinon
      //    un correspondant pourrait se promouvoir réalisateur de la salle.
      const joined = await fetch('/api/participants/me/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...devices,
          cameraEnabled: true,
          micEnabled: true,
        }),
      })
      if (!joined.ok) {
        const data = (await joined.json()) as { error?: { message?: string } }
        setError(data.error?.message ?? 'Entrée en salle refusée.')
        return
      }
      setPayload((await joined.json()) as JoinPayload)
      setPhase('live')
    } catch {
      setError('Le serveur est injoignable. Vérifiez votre connexion et réessayez.')
    } finally {
      setJoining(false)
    }
  }

  if (phase === 'live' && payload) {
    return <LiveCall payload={payload} onLeave={() => setPhase('left')} />
  }

  if (phase === 'left') {
    return (
      <main className="flex min-h-screen items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <p className="text-base font-semibold text-txt">Liaison terminée</p>
          <p className="text-xs text-txt2">
            Merci. Vous pouvez fermer cette page. Pour revenir, ouvrez à nouveau le lien
            que la régie vous a envoyé — il reste valable jusqu&apos;à son expiration.
          </p>
        </div>
      </main>
    )
  }

  return (
    <GreenRoom
      productionName={productionName}
      sessionName={sessionName}
      displayName={displayName}
      profiles={profiles}
      profile={profile}
      onProfileChange={setProfile}
      stunUrls={stunUrls}
      joining={joining}
      joinError={error}
      onJoin={join}
    />
  )
}
