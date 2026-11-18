import { redirect } from 'next/navigation'
import { currentUser } from '@/server/auth/guard'
import { activeSessionId } from '@/server/services/navigation'

export const dynamic = 'force-dynamic'

/**
 * Racine : on ouvre la régie en cours s'il y en a une, sinon la liste des
 * émissions. La même règle sert à décider si la barre de navigation affiche
 * « Régie » — voir `activeSessionId`.
 */
export default async function Home() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const sessionId = await activeSessionId(user)
  redirect(sessionId ? `/control/${sessionId}` : '/productions')
}
