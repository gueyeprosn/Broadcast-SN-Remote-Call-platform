import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { can, type Capability } from '@/lib/rbac'
import { readParticipantSession, readUserSession } from './session'
import type { Role } from '@/generated/prisma/enums'

export class HttpError extends Error {
  readonly status: number
  readonly code: string

  // Déclarations explicites plutôt que des propriétés de paramètre : cette
  // syntaxe n'est pas supportée par le mode « strip types » de Node, utilisé
  // pour exécuter les tests sans transpilation.
  constructor(status: number, message: string, code: string = 'error') {
    super(message)
    this.name = 'HttpError'
    this.status = status
    this.code = code
  }
}

export interface AuthedUser {
  id: string
  email: string
  displayName: string
  role: Role
}

/**
 * Charge l'utilisateur de la requête. Le jeton seul ne suffit pas : on relit
 * l'utilisateur en base et on vérifie `tokenEpoch`. Un compte désactivé ou dont
 * le mot de passe a changé perd l'accès immédiatement, sans attendre
 * l'expiration de son cookie.
 */
export async function currentUser(): Promise<AuthedUser | null> {
  const session = await readUserSession()
  if (!session) return null
  const user = await db.user.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      email: true,
      displayName: true,
      role: true,
      isActive: true,
      tokenEpoch: true,
    },
  })
  if (!user || !user.isActive) return null
  if (user.tokenEpoch !== session.epoch) return null
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role }
}

export async function requireUser(): Promise<AuthedUser> {
  const user = await currentUser()
  if (!user) throw new HttpError(401, 'Authentification requise.', 'unauthenticated')
  return user
}

export async function requireCapability(capability: Capability): Promise<AuthedUser> {
  const user = await requireUser()
  if (!can(user.role, capability)) {
    throw new HttpError(403, `Action non autorisée pour le rôle ${user.role}.`, 'forbidden')
  }
  return user
}

/**
 * Variante destinée aux **pages**, et non aux routes d'API.
 *
 * `requireCapability` lève une `HttpError`, ce qu'un gestionnaire de route sait
 * traduire en JSON. Dans un composant serveur, personne ne la rattrape : la
 * page rend une erreur 500 brute. Un utilisateur qui tape une URL à laquelle il
 * n'a pas droit mérite mieux qu'une page d'erreur — l'accès est refusé dans les
 * deux cas, mais ici il est renvoyé là où il a le droit d'être, avec le motif.
 */
export async function requirePageCapability(capability: Capability): Promise<AuthedUser> {
  const user = await currentUser()
  if (!user) redirect('/login')
  if (!can(user.role, capability)) {
    redirect(`/productions?refuse=${encodeURIComponent(capability)}`)
  }
  return user
}

/**
 * Rattrape une `HttpError` d'accès dans une page et renvoie vers la liste des
 * productions. `redirect()` lève une erreur interne à Next : on ne doit donc
 * jamais l'appeler depuis le bloc `try`, seulement après.
 */
export function pageAccessDenied(error: unknown, motif: string): never {
  if (error instanceof HttpError && (error.status === 403 || error.status === 404)) {
    redirect(`/productions?refuse=${encodeURIComponent(motif)}`)
  }
  throw error
}

export interface AuthedParticipant {
  id: string
  sessionId: string
  displayName: string
  streamId: string
}

/**
 * Charge le correspondant de la requête. Comme pour les utilisateurs, l'état
 * réel est relu en base : révocation, fin de session et rotation d'`epoch`
 * coupent l'accès sans attendre l'expiration du cookie.
 */
export async function requireParticipant(): Promise<AuthedParticipant> {
  const session = await readParticipantSession()
  if (!session) throw new HttpError(401, 'Lien d’accès requis.', 'unauthenticated')
  const participant = await db.participant.findUnique({
    where: { id: session.sub },
    select: {
      id: true,
      sessionId: true,
      displayName: true,
      streamId: true,
      state: true,
      session: { select: { state: true, tokenEpoch: true } },
    },
  })
  if (!participant || participant.sessionId !== session.sid) {
    throw new HttpError(401, 'Accès invalide.', 'unauthenticated')
  }
  if (participant.session.tokenEpoch !== session.epoch) {
    throw new HttpError(401, 'Votre accès a été réinitialisé par la régie.', 'epoch_rotated')
  }
  if (participant.state === 'REVOKED') {
    throw new HttpError(403, 'Votre accès a été révoqué.', 'revoked')
  }
  if (participant.session.state === 'ENDED') {
    throw new HttpError(410, 'La session est terminée.', 'session_ended')
  }
  return {
    id: participant.id,
    sessionId: participant.sessionId,
    displayName: participant.displayName,
    streamId: participant.streamId,
  }
}
