/**
 * Création du premier compte administrateur.
 *
 * Le mot de passe n'est jamais écrit dans ce fichier ni généré en dur : il vient
 * de SEED_ADMIN_PASSWORD. Sans cette variable, le script s'arrête — un compte
 * administrateur avec un mot de passe par défaut connu est une porte ouverte.
 *
 *   SEED_ADMIN_EMAIL=... SEED_ADMIN_PASSWORD=... npm run db:seed
 */
import 'dotenv/config'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../src/generated/prisma/client.ts'
import { hashPassword } from '../src/server/auth/password.ts'

async function main(): Promise<void> {
  const email = process.env['SEED_ADMIN_EMAIL']?.trim().toLowerCase()
  const password = process.env['SEED_ADMIN_PASSWORD']
  const connectionString = process.env['DATABASE_URL']

  if (!connectionString) throw new Error('DATABASE_URL est absent.')
  if (!email) throw new Error('SEED_ADMIN_EMAIL est absent.')
  if (!password || password.length < 12) {
    throw new Error('SEED_ADMIN_PASSWORD est absent ou fait moins de 12 caractères.')
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
  try {
    const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
    if (existing) {
      console.log(`Le compte ${email} existe déjà. Aucune modification.`)
      return
    }
    const user = await db.user.create({
      data: {
        email,
        displayName: 'Administrateur',
        role: 'ADMIN',
        passwordHash: await hashPassword(password),
      },
      select: { id: true, email: true },
    })
    console.log(`Compte administrateur créé : ${user.email}`)
    console.log('Connectez-vous, puis créez les comptes réalisateur et technicien.')
  } finally {
    await db.$disconnect()
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
