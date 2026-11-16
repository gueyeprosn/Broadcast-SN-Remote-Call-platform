import { z } from 'zod'
import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { hashToken } from '@/lib/ids'
import { isPrivateHost } from '@/lib/vmix/client'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody, problem } from '@/server/http'
import { audit } from '@/server/services/audit'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => {
    await requireCapability('vmix.read')
    const connections = await db.vmixConnection.findMany({
      orderBy: { createdAt: 'asc' },
      // `agentTokenHash` n'est jamais renvoyé.
      select: {
        id: true,
        label: true,
        host: true,
        port: true,
        mode: true,
        allowAddInput: true,
        allowProgramControl: true,
        returnBuses: true,
        lastCheckedAt: true,
        lastStatus: true,
        vmixVersion: true,
        vmixEdition: true,
      },
    })
    return json({ connections })
  })
}

const schema = z.object({
  label: z.string().min(2).max(80),
  host: z.string().min(1).max(200),
  port: z.number().int().min(1).max(65535).default(8088),
  mode: z.enum(['DIRECT', 'AGENT']).default('AGENT'),
  allowAddInput: z.boolean().default(false),
  allowProgramControl: z.boolean().default(false),
  returnBuses: z.array(z.enum(['M', 'A', 'B', 'C', 'D', 'E', 'F', 'G'])).default([]),
})

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireCapability('vmix.manage')
    const body = await parseBody(request, schema)

    // Refus à l'exécution, pas simple avertissement dans la documentation.
    if (body.mode === 'DIRECT' && !isPrivateHost(body.host)) {
      return problem(
        400,
        `« ${body.host} » n'est pas une adresse de réseau local. L'API vMix ne ` +
          "documente aucune authentification : elle ne doit jamais être joignable " +
          'depuis Internet. Utilisez le mode AGENT.',
        'forbidden_host',
      )
    }

    // Le couple hôte/port est unique : sans ce contrôle, la contrainte de base
    // remonterait une erreur 500 opaque alors que la cause est évidente.
    const duplicate = await db.vmixConnection.findFirst({
      where: { host: body.host.trim(), port: body.port },
      select: { id: true, label: true },
    })
    if (duplicate) {
      return problem(
        409,
        `Une connexion existe déjà pour ${body.host.trim()}:${body.port} ` +
          `(« ${duplicate.label} »). Modifiez-la plutôt que d'en créer une seconde.`,
        'duplicate_host',
      )
    }

    const agentToken = env().VMIX_AGENT_TOKEN
    const connection = await db.vmixConnection.create({
      data: {
        label: body.label.trim(),
        host: body.host.trim(),
        port: body.port,
        mode: body.mode,
        allowAddInput: body.allowAddInput,
        allowProgramControl: body.allowProgramControl,
        returnBuses: body.returnBuses,
        // Empreinte seulement : la valeur réelle reste un secret de déploiement.
        agentTokenHash: body.mode === 'AGENT' && agentToken ? hashToken(agentToken) : null,
        createdById: user.id,
      },
      select: { id: true, label: true, host: true, port: true, mode: true },
    })

    await audit({
      action: 'vmix.connection.create',
      actorId: user.id,
      actorLabel: user.displayName,
      target: connection.id,
      detail: { host: connection.host, port: connection.port, mode: connection.mode },
    })
    return json({ connection }, 201)
  })
}
