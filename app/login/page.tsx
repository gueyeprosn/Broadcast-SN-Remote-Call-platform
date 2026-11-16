import { redirect } from 'next/navigation'
import { Brand } from '@/components/Brand'
import { LoginForm } from '@/components/LoginForm'
import { currentUser } from '@/server/auth/guard'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Connexion' }

export default async function LoginPage() {
  if (await currentUser()) redirect('/productions')

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-6">
        <Brand size="lg" withSignature />
        <div className="panel p-5">
          <h1 className="mb-4 text-sm font-semibold text-txt">Accès régie</h1>
          <LoginForm />
        </div>
        <p className="text-center text-2xs text-txt2">
          Les correspondants n&apos;utilisent pas cette page : ils reçoivent un lien
          d&apos;invitation nominatif.
        </p>
      </div>
    </main>
  )
}
