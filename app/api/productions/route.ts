import { z } from 'zod'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { createProduction, listProductions } from '@/server/services/production'

export const dynamic = 'force-dynamic'

export async function GET() {
  return handle(async () => {
    const user = await requireCapability('production.read')
    return json({ productions: await listProductions(user) })
  })
}

const createSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  defaultQualityProfile: z.enum(['ECONOMY', 'STANDARD', 'BROADCAST', 'HIGH']).optional(),
})

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireCapability('production.write')
    const body = await parseBody(request, createSchema)
    const production = await createProduction(user, body)
    return json({ production }, 201)
  })
}
