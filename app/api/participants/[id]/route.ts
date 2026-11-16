import { z } from 'zod'
import { requireCapability, HttpError } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import {
  setOnAir,
  setPermissions,
  setQualityProfile,
  setReturnBus,
  revokeParticipant,
} from '@/server/services/participant'

export const dynamic = 'force-dynamic'

const schema = z
  .object({
    onAir: z.boolean().optional(),
    micAllowed: z.boolean().optional(),
    cameraAllowed: z.boolean().optional(),
    qualityProfile: z.enum(['ECONOMY', 'STANDARD', 'BROADCAST', 'HIGH']).optional(),
    returnBus: z.string().max(1).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, { message: 'Aucun champ à modifier.' })

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const { id } = await context.params
    const body = await parseBody(request, schema)

    // Chaque champ exige sa propre capacité : un technicien peut couper un micro
    // mais ne peut pas décider qui passe à l'antenne.
    if (body.onAir !== undefined) {
      const user = await requireCapability('participant.onair')
      await setOnAir(user, id, body.onAir)
    }
    if (body.micAllowed !== undefined || body.cameraAllowed !== undefined) {
      const user = await requireCapability('participant.write')
      await setPermissions(user, id, {
        ...(body.micAllowed !== undefined ? { micAllowed: body.micAllowed } : {}),
        ...(body.cameraAllowed !== undefined ? { cameraAllowed: body.cameraAllowed } : {}),
      })
    }
    if (body.qualityProfile !== undefined) {
      const user = await requireCapability('participant.write')
      await setQualityProfile(user, id, body.qualityProfile)
    }
    if (body.returnBus !== undefined) {
      const user = await requireCapability('control.returnbus')
      await setReturnBus(user, id, body.returnBus)
    }
    return json({ ok: true })
  })
}

const revokeSchema = z.object({ reason: z.string().min(3).max(200) })

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('invitation.revoke')
    const { id } = await context.params
    let reason = 'Révoqué par la régie'
    try {
      reason = (await parseBody(request, revokeSchema)).reason
    } catch (error) {
      // Un corps absent est accepté : la révocation ne doit pas échouer pour
      // une question de formulaire pendant un direct.
      if (error instanceof HttpError && error.status !== 400) throw error
    }
    await revokeParticipant(user, id, reason)
    return json({ ok: true })
  })
}
