import { redirect } from 'next/navigation'
import { currentUser } from '@/server/auth/guard'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

export default async function Home() {
  const user = await currentUser()
  if (!user) redirect('/login')
  const session = await db.session.findFirst({
    where: {
      state: { in: ['LIVE', 'SCHEDULED'] },
      production: {
        isArchived: false,
        ...(user.role === 'DIRECTOR' ? { ownerId: user.id } : {}),
      },
    },
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    select: { id: true },
  })
  redirect(session ? `/control/${session.id}` : '/productions')
}
