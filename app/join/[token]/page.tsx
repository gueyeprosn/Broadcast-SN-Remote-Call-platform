import { Brand } from '@/components/Brand'
import { Notice } from '@/components/ui'
import { env } from '@/lib/env'
import { QUALITY_PROFILES } from '@/lib/media/engine'
import { FAILURE_MESSAGES, resolveInvitation } from '@/server/services/invitation'
import { JoinFlow } from '@/components/correspondent/JoinFlow'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Connexion correspondant', robots: { index: false } }

export default async function JoinPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params

  // Résolution en lecture seule : ouvrir la page ne consomme pas d'utilisation.
  // Le crédit n'est débité qu'au moment où le correspondant entre réellement en
  // salle — un rechargement pendant les réglages ne coûte donc rien.
  const resolved = await resolveInvitation(token)

  if (!resolved.ok) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md space-y-5">
          <Brand size="lg" withSignature />
          <Notice tone="crit" title="Accès impossible">
            {FAILURE_MESSAGES[resolved.reason]}
          </Notice>
          <p className="text-xs text-txt2">
            Si vous êtes attendu à l&apos;antenne, contactez la régie : elle peut
            régénérer un lien en quelques secondes.
          </p>
        </div>
      </main>
    )
  }

  const stunUrls = env()
    .STUN_URLS.split(',')
    .map((url) => url.trim())
    .filter(Boolean)

  return (
    <JoinFlow
      token={token}
      productionName={resolved.session.productionName}
      sessionName={resolved.session.name}
      displayName={resolved.participant.displayName}
      defaultProfile={resolved.participant.qualityProfile}
      profiles={Object.values(QUALITY_PROFILES)}
      stunUrls={stunUrls}
    />
  )
}
