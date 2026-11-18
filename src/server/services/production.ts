import { db } from '@/lib/db'
import { slugify } from '@/lib/ids'
import { HttpError, type AuthedUser } from '@/server/auth/guard'
import { audit } from './audit'
import type { QualityProfile } from '@/generated/prisma/enums'

export async function listProductions(
  user: AuthedUser,
  options: { archived?: boolean } = {},
) {
  // Un réalisateur voit les productions dont il est propriétaire ; un admin voit tout.
  const where = {
    isArchived: options.archived === true,
    ...(user.role === 'ADMIN' ? {} : { ownerId: user.id }),
  }
  return db.production.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    include: {
      owner: { select: { displayName: true } },
      _count: { select: { sessions: true } },
      sessions: {
        where: { state: { in: ['SCHEDULED', 'LIVE'] } },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { id: true, name: true, state: true, scheduledAt: true },
      },
    },
  })
}

/** Nombre d'émissions rangées, pour n'afficher le lien que s'il mène quelque part. */
export async function countArchivedProductions(user: AuthedUser): Promise<number> {
  return db.production.count({
    where: {
      isArchived: true,
      ...(user.role === 'ADMIN' ? {} : { ownerId: user.id }),
    },
  })
}

export async function createProduction(
  user: AuthedUser,
  input: { name: string; description?: string | null; defaultQualityProfile?: QualityProfile },
) {
  const name = input.name.trim()
  if (name.length < 2) throw new HttpError(400, 'Le nom de la production est trop court.')

  const base = slugify(name)
  let slug = base
  for (let attempt = 1; attempt < 50; attempt += 1) {
    const taken = await db.production.findUnique({ where: { slug }, select: { id: true } })
    if (!taken) break
    slug = `${base}-${attempt + 1}`
  }

  const production = await db.production.create({
    data: {
      name,
      slug,
      description: input.description?.trim() || null,
      defaultQualityProfile: input.defaultQualityProfile ?? 'BROADCAST',
      ownerId: user.id,
    },
  })
  await audit({
    action: 'production.create',
    actorId: user.id,
    actorLabel: user.displayName,
    target: production.id,
    detail: { name: production.name },
  })
  return production
}

export async function getProductionForUser(user: AuthedUser, productionId: string) {
  const production = await db.production.findUnique({
    where: { id: productionId },
    include: {
      owner: { select: { id: true, displayName: true } },
      sessions: {
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { participants: true } } },
      },
    },
  })
  if (!production) throw new HttpError(404, 'Production introuvable.')
  if (user.role !== 'ADMIN' && production.ownerId !== user.id) {
    // Un technicien peut lire une production à laquelle il est rattaché par une
    // session ; dans cette version il n'y a pas d'affectation nominative, donc
    // on reste strict plutôt que permissif.
    if (user.role !== 'TECHNICIAN') throw new HttpError(403, 'Production non accessible.')
  }
  return production
}
