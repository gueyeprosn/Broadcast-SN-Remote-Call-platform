import { db } from '@/lib/db'
import { log } from '@/lib/logger'
import type { Prisma } from '@/generated/prisma/client'

export type AuditOutcome = 'ok' | 'denied' | 'error'

export interface AuditInput {
  action: string
  actorId?: string | null
  actorKind?: 'user' | 'participant' | 'system'
  actorLabel?: string | null
  target?: string | null
  outcome?: AuditOutcome
  detail?: Prisma.InputJsonValue
  ip?: string | null
  userAgent?: string | null
}

/**
 * Journal d'audit. Les actions **refusées** y figurent aussi : un journal qui ne
 * contient que les succès ne sert à rien pour détecter une tentative d'intrusion.
 *
 * L'écriture ne doit jamais faire échouer l'action métier : en cas d'erreur de
 * base, on journalise la perte sur la sortie standard et on continue.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        action: input.action,
        actorId: input.actorId ?? null,
        actorKind: input.actorKind ?? 'user',
        actorLabel: input.actorLabel ?? null,
        target: input.target ?? null,
        outcome: input.outcome ?? 'ok',
        detail: input.detail ?? undefined,
        ip: input.ip ?? null,
        userAgent: input.userAgent?.slice(0, 300) ?? null,
      },
    })
  } catch (error) {
    log.error('audit.write_failed', {
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export interface RequestContext {
  ip: string | null
  userAgent: string | null
}

export function requestContext(headers: Headers): RequestContext {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return {
    ip: forwarded || headers.get('x-real-ip') || null,
    userAgent: headers.get('user-agent') ?? null,
  }
}
