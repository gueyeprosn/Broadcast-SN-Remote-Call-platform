'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from '@/components/ui'

export function LogoutButton({ children }: { children?: React.ReactNode }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <Button
      size="sm"
      variant="ghost"
      title="Se déconnecter"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        await fetch('/api/auth/logout', { method: 'POST' })
        router.replace('/login')
        router.refresh()
      }}
    >
      {children}
      <span className="sr-only">Se déconnecter</span>
    </Button>
  )
}
