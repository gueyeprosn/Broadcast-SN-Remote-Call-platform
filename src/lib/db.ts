import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@/generated/prisma/client'

/**
 * Client Prisma unique, créé **paresseusement**.
 *
 * Deux raisons :
 *  - la compilation ne doit pas exiger une base accessible ni même un
 *    `DATABASE_URL` : un échec de build pour une variable d'environnement
 *    absente au moment de l'empaquetage n'apporte rien ;
 *  - en développement, Next recharge les modules à chaud ; sans le cache global
 *    on ouvrirait un pool de connexions à chaque rechargement.
 */
const globalForPrisma = globalThis as unknown as { snrcPrisma?: PrismaClient }

function create(): PrismaClient {
  const connectionString = process.env['DATABASE_URL']
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL est absent. Renseignez-le dans .env (voir .env.example).',
    )
  }
  const client = new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
    log: process.env['NODE_ENV'] === 'development' ? ['warn', 'error'] : ['error'],
  })
  if (process.env['NODE_ENV'] !== 'production') globalForPrisma.snrcPrisma = client
  return client
}

function client(): PrismaClient {
  return globalForPrisma.snrcPrisma ?? create()
}

/**
 * Façade paresseuse : la connexion n'est établie qu'au premier accès réel à un
 * modèle, donc jamais pendant la compilation.
 */
export const db: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    const value = Reflect.get(client() as object, property, receiver) as unknown
    return typeof value === 'function'
      ? (value as (...args: unknown[]) => unknown).bind(client())
      : value
  },
  has(_target, property) {
    return Reflect.has(client() as object, property)
  },
})
