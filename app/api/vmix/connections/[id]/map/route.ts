import { z } from 'zod'
import { requireCapability } from '@/server/auth/guard'
import { handle, json, parseBody } from '@/server/http'
import { mapParticipantToInput, participantAudio } from '@/server/services/vmix'

export const dynamic = 'force-dynamic'

const mapSchema = z.object({
  participantId: z.string().min(1),
  inputKey: z.string().min(1).max(100),
})

/** Associe un correspondant à une entrée Web Browser existante. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('vmix.navigate')
    const { id } = await context.params
    const body = await parseBody(request, mapSchema)
    const result = await mapParticipantToInput(user, {
      connectionId: id,
      participantId: body.participantId,
      inputKey: body.inputKey,
    })
    // `displaced` n'est pas nul quand l'entrée servait déjà un autre
    // correspondant : la console doit pouvoir le dire à l'opérateur.
    return json({ mapping: result.mapping, displaced: result.displaced })
  })
}

const audioSchema = z.object({
  participantId: z.string().min(1),
  action: z.enum(['AudioOn', 'AudioOff', 'SetVolume', 'AudioBusOn', 'AudioBusOff']),
  value: z.string().max(10).optional(),
})

/** Commande audio sur l'entrée vMix du correspondant. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const user = await requireCapability('vmix.audio')
    const { id } = await context.params
    const body = await parseBody(request, audioSchema)
    const result = await participantAudio(user, {
      connectionId: id,
      participantId: body.participantId,
      action: body.action,
      ...(body.value !== undefined ? { value: body.value } : {}),
    })
    return json({ ok: true, function: result.spec.name, risk: result.spec.risk })
  })
}
