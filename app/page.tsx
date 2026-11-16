import { redirect } from 'next/navigation'
import { currentUser } from '@/server/auth/guard'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const user = await currentUser()
  redirect(user ? '/productions' : '/login')
}
