import type { Role } from '@/generated/prisma/enums'

/**
 * Capacités atomiques. Les routes exigent une capacité, jamais un rôle en dur :
 * ajouter un rôle ne demande alors que de modifier cette table.
 */
export const CAPABILITIES = [
  // Productions / sessions
  'production.read',
  'production.write',
  'session.read',
  'session.write',
  'session.end',
  // Correspondants
  'participant.read',
  'participant.write',
  'participant.onair',
  'participant.disconnect',
  'invitation.create',
  'invitation.revoke',
  // Régie
  'control.view',
  'control.mic',
  'control.camera',
  'control.message',
  'control.talkback',
  'control.returnbus',
  'metrics.read',
  // vMix
  'vmix.read',
  'vmix.navigate',
  'vmix.audio',
  'vmix.program',
  'vmix.manage',
  // Administration
  'user.read',
  'user.write',
  'audit.read',
  // Rétention des données
  'retention.read',
  'retention.run',
] as const

export type Capability = (typeof CAPABILITIES)[number]

const DIRECTOR: Capability[] = [
  'production.read',
  'production.write',
  'session.read',
  'session.write',
  'session.end',
  'participant.read',
  'participant.write',
  'participant.onair',
  'participant.disconnect',
  'invitation.create',
  'invitation.revoke',
  'control.view',
  'control.mic',
  'control.camera',
  'control.message',
  'control.talkback',
  'control.returnbus',
  'metrics.read',
  'vmix.read',
  'vmix.navigate',
  'vmix.audio',
  'vmix.program',
]

/**
 * Le technicien supervise et pilote l'audio, mais n'invite pas et ne révoque pas :
 * la maîtrise de qui entre en antenne reste au réalisateur.
 */
const TECHNICIAN: Capability[] = [
  'production.read',
  'session.read',
  'participant.read',
  'control.view',
  'control.mic',
  'control.camera',
  'control.returnbus',
  'metrics.read',
  'vmix.read',
  'vmix.navigate',
  'vmix.audio',
]

const MATRIX: Record<Role, readonly Capability[]> = {
  ADMIN: CAPABILITIES,
  DIRECTOR,
  TECHNICIAN,
}

export function can(role: Role, capability: Capability): boolean {
  return MATRIX[role].includes(capability)
}

export function capabilitiesOf(role: Role): readonly Capability[] {
  return MATRIX[role]
}

/**
 * Capacités d'un correspondant. Un correspondant n'est pas un `User` et n'a
 * aucune capacité de console : la liste est volontairement vide côté serveur,
 * ses actions passent par des routes dédiées `/api/participants/me/*`.
 */
export const PARTICIPANT_CAPABILITIES: readonly Capability[] = []
