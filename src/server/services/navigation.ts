import { db } from '@/lib/db'
import type { AuthedUser } from '@/server/auth/guard'

/**
 * Session de régie « courante » pour cet utilisateur : la plus récemment
 * touchée parmi celles qui ne sont pas terminées.
 *
 * Utilisée à deux endroits — la racine, qui y renvoie directement, et la barre
 * de navigation, qui n'affiche « Régie » que s'il y a bien une régie où aller.
 * Les deux doivent répondre la même chose, d'où ce point unique : deux requêtes
 * écrites séparément finiraient par diverger, et la barre proposerait un lien
 * vers une session que la racine n'ouvre pas.
 *
 * Un réalisateur ne voit que ses propres productions ; un administrateur ou un
 * technicien voit celles de l'instance, comme partout ailleurs.
 */
export async function activeSessionId(user: AuthedUser): Promise<string | null> {
  const session = await db.session.findFirst({
    where: {
      state: { in: ['LIVE', 'SCHEDULED'] },
      production: {
        isArchived: false,
        ...(user.role === 'DIRECTOR' ? { ownerId: user.id } : {}),
      },
    },
    // `id` en second critère : sans lui, deux sessions mises à jour dans la même
    // milliseconde se classeraient au hasard, et le lien changerait d'une page
    // à l'autre.
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  return session?.id ?? null
}
