import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/**
 * Configuration ESLint « flat » (Next 16 fournit directement des configs plates,
 * il n'y a donc pas de couche de compatibilité ici).
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      // Code produit par Prisma : on ne le relit pas.
      'src/generated/**',
      'packages/vmix-agent/node_modules/**',
    ],
  },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Une variable inutilisée signale presque toujours un oubli.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // `any` effacerait les contrats de l'API IFrame, qu'on tient à typer.
      '@typescript-eslint/no-explicit-any': 'error',
      // Avis d'optimisation du compilateur React : utile à lire, mais ne doit
      // pas bloquer une compilation — le code reste correct sans mémoïsation.
      'react-hooks/preserve-manual-memoization': 'warn',
    },
  },
]

export default config
