'use client'

import { useEffect } from 'react'

/**
 * Amène un élément à l'écran après un rendu serveur.
 *
 * Sert au retour visuel de création : l'émission créée apparaît en tête de
 * liste alors que le formulaire est ailleurs sur la page. Sans ce défilement,
 * on clique « Créer » et rien ne bouge devant soi — on croit que ça a échoué.
 */
export function ScrollToAnchor({ targetId }: { targetId: string }) {
  useEffect(() => {
    const element = document.getElementById(targetId)
    if (!element) return
    element.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [targetId])

  return null
}
