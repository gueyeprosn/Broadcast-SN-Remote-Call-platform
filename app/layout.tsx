import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: {
    default: 'Broadcast SN Remote Call',
    template: '%s · Broadcast SN Remote Call',
  },
  description: 'Professional Remote Contribution Platform',
  robots: { index: false, follow: false },
  applicationName: 'Broadcast SN Remote Call',
}

export const viewport: Viewport = {
  themeColor: '#0B111B',
  width: 'device-width',
  initialScale: 1,
  // La régie et la page correspondant sont des interfaces de contrôle :
  // un zoom accidentel en direct est un incident.
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  )
}
