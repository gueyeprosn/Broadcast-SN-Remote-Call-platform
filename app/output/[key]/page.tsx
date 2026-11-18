import { db } from '@/lib/db'
import { QUALITY_PROFILES } from '@/lib/media/engine'
import { engine } from '@/lib/media/vdoninja'

export const dynamic = 'force-dynamic'

export const metadata = {
  title: 'Sortie vMix',
  robots: { index: false, follow: false },
}

/**
 * Page de sortie destinée à un Web Browser Input vMix.
 *
 * Contraintes tenues ici :
 *  - aucun bouton, menu, logo, bordure, curseur ;
 *  - fond laissé transparent pour permettre le canal alpha de vMix ;
 *  - révocation vérifiée **côté serveur à chaque chargement** : une URL de
 *    moteur collée directement dans vMix resterait valable indéfiniment, celle-ci
 *    non ;
 *  - le secret de salle n'apparaît pas dans la configuration de vMix, où
 *    n'importe qui pourrait le lire.
 *
 * Dimensions recommandées pour l'entrée vMix : la résolution du profil du
 * correspondant (1280×720 pour Broadcast).
 */
export default async function OutputPage({
  params,
}: {
  params: Promise<{ key: string }>
}) {
  const { key } = await params

  const participant = await db.participant.findUnique({
    where: { outputKey: key },
    select: {
      displayName: true,
      state: true,
      streamId: true,
      qualityProfile: true,
      session: {
        select: { state: true, roomName: true, roomSecret: true },
      },
    },
  })

  if (!participant) return <Slate title="Lien de sortie inconnu" />
  if (participant.state === 'REVOKED') {
    return <Slate title="Accès révoqué" detail={participant.displayName} />
  }
  if (participant.session.state === 'ENDED') {
    return <Slate title="Session terminée" detail={participant.displayName} />
  }

  const url = engine().receiverUrl({
    roomName: participant.session.roomName,
    roomSecret: participant.session.roomSecret,
    streamId: participant.streamId,
    profile: QUALITY_PROFILES[participant.qualityProfile],
  })

  return (
    <div className="output-root">
      {/* vMix n'applique le canal alpha que si le `<body>` n'a pas de couleur de
          fond. La feuille de style globale en pose une (#0B111B) pour toute
          l'application : on la neutralise ici, et seulement ici. Sans cela, la
          transparence annoncée dans docs/05-VMIX-INTEGRATION.md ne fonctionne
          pas, quels que soient les réglages côté vMix. */}
      <style>{'html,body{background:transparent !important;}'}</style>
      <iframe
        src={url}
        title=""
        allow="autoplay"
        // `scrolling` est déprécié en HTML5 mais reste respecté par le CEF de
        // vMix : il évite une barre de défilement grise dans l'entrée.
        scrolling="no"
        style={{
          position: 'fixed',
          inset: 0,
          width: '100%',
          height: '100%',
          border: 0,
          margin: 0,
          padding: 0,
          display: 'block',
          background: 'transparent',
        }}
      />
    </div>
  )
}

/**
 * Mire d'erreur nommée. Visible directement dans la vignette vMix : un
 * technicien voit « Session terminée » plutôt qu'un cadre noir muet.
 */
function Slate({ title, detail }: { title: string; detail?: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        background: '#0B111B',
        color: '#9BAABD',
        fontFamily: 'system-ui, sans-serif',
        userSelect: 'none',
        cursor: 'none',
      }}
    >
      <p
        style={{
          margin: 0,
          fontSize: 34,
          fontWeight: 600,
          letterSpacing: '0.02em',
          color: '#FF4D4F',
        }}
      >
        {title}
      </p>
      {detail && <p style={{ margin: 0, fontSize: 20 }}>{detail}</p>}
      <p style={{ margin: 0, fontSize: 13, opacity: 0.6, letterSpacing: '0.14em' }}>
        BROADCAST SN REMOTE CALL
      </p>
    </div>
  )
}
