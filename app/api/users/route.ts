import { z } from 'zod'
import { db } from '@/lib/db'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody, problem } from '@/server/http'
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/server/auth/password'
import { audit } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => {
    await requireCapability('user.read')
    const users = await db.user.findMany({
      orderBy: { createdAt: 'asc' },
      // `passwordHash` n'est jamais renvoyé.
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        lastLoginAt: true,
        lockedUntil: true,
        createdAt: true,
      },
    })
    return json({ users })
  })
}

const schema = z.object({
  email: z.string().email().max(200),
  displayName: z.string().min(2).max(80),
  role: z.enum(['ADMIN', 'DIRECTOR', 'TECHNICIAN']),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
})

export async function POST(request: Request) {
  return handle(async () => {
    const actor = await requireCapability('user.write')
    const body = await parseBody(request, schema)
    const email = body.email.trim().toLowerCase()

    if (await db.user.findUnique({ where: { email }, select: { id: true } })) {
      return problem(409, 'Un compte existe déjà avec cette adresse.', 'duplicate')
    }

    const user = await db.user.create({
      data: {
        email,
        displayName: body.displayName.trim(),
        role: body.role,
        passwordHash: await hashPassword(body.password),
      },
      select: { id: true, email: true, displayName: true, role: true },
    })
    await audit({
      action: 'user.create',
      actorId: actor.id,
      actorLabel: actor.displayName,
      target: user.id,
      detail: { role: user.role },
    })
    return json({ user }, 201)
  })
}
