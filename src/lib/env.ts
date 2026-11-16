import { z } from 'zod'

/**
 * Validation de la configuration au démarrage.
 * Un secret manquant ou trop court fait échouer le démarrage en production
 * plutôt que de laisser l'application tourner avec une sécurité illusoire.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET doit faire au moins 32 caractères'),
  MEDIA_SECRET: z.string().min(32, 'MEDIA_SECRET doit faire au moins 32 caractères'),
  MEDIA_ENGINE_ORIGIN: z.string().url(),
  MEDIA_ENGINE_ID: z.string().min(1).default('vdoninja'),
  VMIX_AGENT_TOKEN: z.string().default(''),
  /**
   * Serveurs STUN séparés par des virgules, utilisés UNIQUEMENT par le test de
   * connexion de la salle de préparation. Sans valeur, le test n'identifie que
   * les candidats locaux et l'interface le dit explicitement.
   */
  STUN_URLS: z.string().default(''),

  /**
   * Durée de conservation, en jours, des données d'une session terminée
   * (participants, invitations, événements de connexion, mappings vMix).
   * Aucun média n'est jamais stocké.
   */
  RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),

  /**
   * Durée de conservation du journal d'audit, en jours.
   *
   * `0` = **jamais purgé**, et c'est le défaut. Le journal d'audit est la trace
   * de qui a fait quoi : le supprimer est une décision à prendre explicitement,
   * pas un effet de bord d'une tâche de ménage.
   */
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(0).max(3650).default(0),

  /**
   * Secret permettant à un planificateur de déclencher la purge sans session
   * utilisateur. Vide = seule une session administrateur peut la lancer.
   */
  CRON_SECRET: z.string().default(''),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
})

export type Env = z.infer<typeof schema>

let cached: Env | null = null

export function env(): Env {
  if (cached) return cached
  const parsed = schema.safeParse(process.env)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(racine)'}: ${i.message}`)
      .join('\n')
    throw new Error(
      `Configuration invalide. Vérifiez votre .env (cf. .env.example) :\n${issues}`,
    )
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (!parsed.data.APP_URL.startsWith('https://')) {
      throw new Error('En production, APP_URL doit être en HTTPS.')
    }
    for (const key of ['AUTH_SECRET', 'MEDIA_SECRET'] as const) {
      if (parsed.data[key].includes('CHANGEZ-MOI')) {
        throw new Error(`${key} est resté à sa valeur d'exemple. Générez-en un vrai.`)
      }
    }
    // Un secret de planificateur trop court serait devinable, et il autorise une
    // suppression de données sans session utilisateur.
    if (parsed.data.CRON_SECRET && parsed.data.CRON_SECRET.length < 24) {
      throw new Error('CRON_SECRET doit faire au moins 24 caractères, ou rester vide.')
    }
  }
  cached = parsed.data
  return cached
}

export const isProd = () => env().NODE_ENV === 'production'
