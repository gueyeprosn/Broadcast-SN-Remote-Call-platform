'use client'

import { useState } from 'react'
import { Check, Copy, ExternalLink, Info } from 'lucide-react'
import { Badge, Button, Notice, Panel } from '@/components/ui'

/**
 * Panneau du retour programme.
 *
 * Il ne « configure » rien : la chaîne de retour est physique (bus vMix → câble
 * audio virtuel → Chrome). Le panneau donne le lien de la page de publication,
 * rappelle l'ordre des opérations et affiche l'identifiant du bus de retour.
 * Prétendre piloter depuis ici un routage audio qui se fait dans vMix serait
 * trompeur.
 */
export function ProgramReturnPanel({
  returnPublisherPath,
  returnStreamId,
  nativeMixMinus,
}: {
  returnPublisherPath: string
  returnStreamId: string
  nativeMixMinus: boolean
}) {
  const [copied, setCopied] = useState(false)
  const url =
    typeof window === 'undefined'
      ? returnPublisherPath
      : new URL(returnPublisherPath, window.location.origin).toString()

  return (
    <Panel
      title="Retour programme"
      actions={<Badge tone="neutral">{returnStreamId}</Badge>}
    >
      <div className="space-y-2.5">
        {!nativeMixMinus && (
          <Notice tone="warn" title="Le mix-minus n'est pas automatique">
            vMix Call fournit un mix-minus à ses propres participants ; une entrée{' '}
            <strong className="text-txt">Web Browser</strong> n&apos;en bénéficie pas. Le
            retour doit être construit bus par bus.
          </Notice>
        )}

        <ol className="space-y-1.5 text-2xs text-txt2">
          <li>
            <span className="text-txt">1.</span> Dans vMix, activez le{' '}
            <strong className="text-txt">Bus A</strong> et dirigez-le vers un câble audio
            virtuel.
          </li>
          <li>
            <span className="text-txt">2.</span> Pour chaque entrée de correspondant :{' '}
            <code className="text-txt">AudioBusOn M</code> et{' '}
            <code className="text-txt">AudioBusOff A</code> — c&apos;est l&apos;opération
            qui l&apos;empêche de s&apos;entendre.
          </li>
          <li>
            <span className="text-txt">3.</span> Ouvrez la page ci-dessous dans un{' '}
            <strong className="text-txt">Chrome réel</strong> sur le PC de régie, pas dans
            vMix, et sélectionnez le câble virtuel comme microphone.
          </li>
        </ol>

        <div className="flex gap-1.5">
          <input
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full rounded border border-line bg-bg px-2 py-1 font-mono text-2xs"
          />
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url)
                setCopied(true)
                setTimeout(() => setCopied(false), 1800)
              } catch {
                window.prompt('Copiez cette adresse :', url)
              }
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.open(url, '_blank')}>
            <ExternalLink size={12} />
          </Button>
        </div>

        <p className="flex gap-1.5 text-2xs text-txt2">
          <Info size={12} className="mt-0.5 shrink-0" />
          La page de retour publie en{' '}
          <em>publish-only</em> : elle ne reçoit aucun flux de la salle. C&apos;est la
          garantie structurelle qu&apos;aucune voix de correspondant ne peut y reboucler.
        </p>
      </div>
    </Panel>
  )
}
