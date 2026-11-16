import { cn } from '@/lib/cn'

/**
 * Marque. Signe graphique construit en SVG inline : pas de requête réseau,
 * fonctionne dans la page correspondant sur un réseau mobile dégradé.
 */
export function Brand({
  size = 'md',
  withSignature = false,
  className,
}: {
  size?: 'sm' | 'md' | 'lg'
  withSignature?: boolean
  className?: string
}) {
  const mark = size === 'lg' ? 34 : size === 'md' ? 26 : 20
  return (
    <div className={cn('flex items-center gap-2.5', className)}>
      <svg
        width={mark}
        height={mark}
        viewBox="0 0 32 32"
        aria-hidden="true"
        className="shrink-0"
      >
        <rect x="0.75" y="0.75" width="30.5" height="30.5" rx="6" fill="#151E2B" stroke="#2A3A4D" />
        {/* Trois arcs : la contribution distante qui remonte vers la régie. */}
        <path d="M11 22a7 7 0 0 1 0-12" stroke="#9BAABD" strokeWidth="1.6" fill="none" strokeLinecap="round" />
        <path d="M7.5 25a11.5 11.5 0 0 1 0-18" stroke="#9BAABD" strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.5" />
        <circle cx="19" cy="16" r="4.2" fill="#FF9B26" />
        <rect x="24" y="12.6" width="3" height="6.8" rx="1.2" fill="#FF9B26" opacity="0.65" />
      </svg>
      <div className="leading-tight">
        <p
          className={cn(
            'font-semibold tracking-tight text-txt',
            size === 'lg' ? 'text-base' : size === 'md' ? 'text-sm' : 'text-xs',
          )}
        >
          BROADCAST SN <span className="text-accent">REMOTE CALL</span>
        </p>
        {withSignature && (
          <p className="text-2xs uppercase tracking-[0.14em] text-txt2">
            Professional Remote Contribution Platform
          </p>
        )}
      </div>
    </div>
  )
}
