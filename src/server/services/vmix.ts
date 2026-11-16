import { db } from '@/lib/db'
import { env } from '@/lib/env'
import { hashToken, safeEqualHex } from '@/lib/ids'
import {
  callFunctionSerialized,
  getState,
  isPrivateHost,
  VmixError,
  type VmixTarget,
} from '@/lib/vmix/client'
import type { VmixState } from '@/lib/vmix/xml'
import { HttpError, type AuthedUser } from '@/server/auth/guard'
import { publish, sessionTopic } from '@/server/events/bus'
import { audit } from './audit'
import { outputPageUrl } from './participant'

/**
 * Adresse de base de l'agent.
 *
 * HTTPS est exigé dès que l'agent n'est pas sur la machine locale : le secret
 * d'agent voyage dans un en-tête, et un réseau de régie reste un réseau. En
 * bouclage, HTTP suffit et évite d'imposer un certificat pour un essai.
 */
function agentBaseUrl(host: string, port: number): string {
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  return `${loopback ? 'http' : 'https'}://${host}:${port}`
}

/**
 * Construit la cible réseau d'une connexion vMix.
 *
 * Le secret de l'agent n'est pas lu en base : la base n'en stocke qu'une
 * empreinte. La valeur réelle vient de `VMIX_AGENT_TOKEN`, donc d'un secret de
 * déploiement, pas d'une donnée applicative. Si l'empreinte ne correspond pas,
 * on refuse — un agent déclaré avec un autre secret ne doit pas être piloté par
 * accident.
 */
export async function targetFor(connectionId: string): Promise<{
  target: VmixTarget
  connection: Awaited<ReturnType<typeof db.vmixConnection.findUniqueOrThrow>>
}> {
  const connection = await db.vmixConnection.findUnique({ where: { id: connectionId } })
  if (!connection) throw new HttpError(404, 'Connexion vMix introuvable.')

  if (connection.mode === 'DIRECT' && !isPrivateHost(connection.host)) {
    throw new HttpError(
      400,
      `« ${connection.host} » n'est pas une adresse de réseau local. ` +
        "L'API vMix ne documente aucune authentification : utilisez le mode AGENT.",
      'forbidden_host',
    )
  }

  const agentToken = env().VMIX_AGENT_TOKEN
  if (connection.mode === 'AGENT') {
    if (!agentToken) {
      throw new HttpError(
        500,
        'Mode AGENT demandé mais VMIX_AGENT_TOKEN n’est pas configuré sur le serveur.',
      )
    }
    if (connection.agentTokenHash && !safeEqualHex(hashToken(agentToken), connection.agentTokenHash)) {
      throw new HttpError(
        409,
        'Le secret d’agent configuré sur le serveur ne correspond pas à celui enregistré pour cette connexion.',
      )
    }
  }

  const target: VmixTarget = {
    host: connection.host,
    port: connection.port,
    mode: connection.mode,
    timeoutMs: 4000,
    ...(connection.mode === 'AGENT'
      ? { agentBaseUrl: agentBaseUrl(connection.host, connection.port), agentToken }
      : {}),
  }
  return { target, connection }
}

/** Teste la connexion et consigne le **résultat réel**, succès ou échec. */
export async function testConnection(user: AuthedUser, connectionId: string) {
  const { target } = await targetFor(connectionId)
  try {
    const state = await getState(target)
    const updated = await db.vmixConnection.update({
      where: { id: connectionId },
      data: {
        lastCheckedAt: new Date(),
        lastStatus: 'ok',
        vmixVersion: state.version,
        vmixEdition: state.edition,
      },
    })
    await audit({
      action: 'vmix.test',
      actorId: user.id,
      actorLabel: user.displayName,
      target: connectionId,
      detail: { version: state.version, edition: state.edition, inputs: state.inputs.length },
    })
    return { ok: true as const, state, connection: updated }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.vmixConnection.update({
      where: { id: connectionId },
      data: { lastCheckedAt: new Date(), lastStatus: message.slice(0, 300) },
    })
    await audit({
      action: 'vmix.test',
      actorId: user.id,
      actorLabel: user.displayName,
      target: connectionId,
      outcome: 'error',
      detail: { message },
    })
    throw error
  }
}

export async function listInputs(connectionId: string): Promise<VmixState> {
  const { target } = await targetFor(connectionId)
  return getState(target)
}

/**
 * Associe un correspondant à une entrée Web Browser **existante** et y pointe
 * notre page de sortie.
 *
 * L'entrée doit préexister : créer une entrée navigateur par l'API n'est pas
 * documenté (cf. docs/01-AUDIT.md §4.2). On ne l'utilise donc pas ici.
 */
export async function mapParticipantToInput(
  user: AuthedUser,
  input: { connectionId: string; participantId: string; inputKey: string },
) {
  const { target, connection } = await targetFor(input.connectionId)

  const participant = await db.participant.findUnique({
    where: { id: input.participantId },
    select: {
      id: true,
      displayName: true,
      outputKey: true,
      sessionId: true,
      session: { select: { production: { select: { ownerId: true } } } },
    },
  })
  if (!participant) throw new HttpError(404, 'Correspondant introuvable.')
  if (user.role === 'DIRECTOR' && participant.session.production.ownerId !== user.id) {
    throw new HttpError(403, 'Correspondant non accessible.')
  }

  const state = await getState(target)
  const vmixInput = state.inputs.find((i) => i.key === input.inputKey)
  if (!vmixInput) {
    throw new HttpError(404, `Aucune entrée vMix avec la clé ${input.inputKey}.`)
  }
  if (!vmixInput.isBrowser) {
    throw new HttpError(
      409,
      `L'entrée « ${vmixInput.title} » est de type ${vmixInput.type ?? 'inconnu'}, ` +
        'pas Web Browser. Créez une entrée Web Browser dans vMix puis réessayez.',
    )
  }

  const url = outputPageUrl(env().APP_URL, participant.outputKey)

  // BrowserNavigate : l'URL est percent-encodée par URLSearchParams dans le
  // client — indispensable, les « ? », « & » et « # » cassent la commande sinon.
  await callFunctionSerialized(target, 'BrowserNavigate', {
    input: vmixInput.key,
    value: url,
  })
  await callFunctionSerialized(target, 'SetInputName', {
    input: vmixInput.key,
    value: participant.displayName,
  })

  // Une entrée vMix ne sert qu'un correspondant à la fois : la contrainte
  // d'unicité (connectionId, inputKey) l'impose. Réaffecter une entrée déjà
  // utilisée est une opération légitime et courante — un correspondant qui
  // remplace un autre sur la même entrée. On libère donc l'entrée avant de la
  // réaffecter, et on signale qui a été déplacé plutôt que d'échouer en silence
  // ou de remonter une violation de contrainte opaque.
  const { mapping, displaced } = await db.$transaction(async (tx) => {
    const previous = await tx.vmixInputMapping.findFirst({
      where: {
        connectionId: connection.id,
        inputKey: vmixInput.key,
        participantId: { not: participant.id },
      },
      select: { id: true, participantId: true, participant: { select: { displayName: true } } },
    })
    if (previous) await tx.vmixInputMapping.delete({ where: { id: previous.id } })

    const result = await tx.vmixInputMapping.upsert({
      where: {
        participantId_connectionId: {
          participantId: participant.id,
          connectionId: connection.id,
        },
      },
      create: {
        connectionId: connection.id,
        sessionId: participant.sessionId,
        participantId: participant.id,
        inputKey: vmixInput.key,
        inputNumber: vmixInput.number,
        inputTitle: participant.displayName,
        lastNavigatedAt: new Date(),
      },
      update: {
        inputKey: vmixInput.key,
        inputNumber: vmixInput.number,
        inputTitle: participant.displayName,
        lastNavigatedAt: new Date(),
        lastError: null,
      },
    })
    return {
      mapping: result,
      displaced: previous
        ? { participantId: previous.participantId, displayName: previous.participant.displayName }
        : null,
    }
  })

  if (displaced) {
    // Le correspondant déplacé n'a plus d'entrée vMix : son voyant ON AIR issu
    // de vMix n'a plus de source, on le remet donc en main.
    await db.participant.updateMany({
      where: { id: displaced.participantId, onAirSource: 'VMIX' },
      data: { onAir: false, onAirSource: 'MANUAL' },
    })
    publish(sessionTopic(participant.sessionId), {
      type: 'vmix.mapping',
      participantId: displaced.participantId,
      inputTitle: null,
    })
  }

  publish(sessionTopic(participant.sessionId), {
    type: 'vmix.mapping',
    participantId: participant.id,
    inputTitle: participant.displayName,
  })
  await audit({
    action: 'vmix.navigate',
    actorId: user.id,
    actorLabel: user.displayName,
    target: participant.id,
    detail: {
      connectionId: connection.id,
      inputKey: vmixInput.key,
      url,
      displaced: displaced?.displayName ?? null,
    },
  })

  return { mapping, displaced }
}

/**
 * Synchronise l'état ON AIR depuis vMix.
 *
 * Marque `onAirSource = VMIX` : l'interface distingue un ON AIR constaté dans
 * vMix d'un ON AIR décidé à la main. Les deux ne sont jamais confondus.
 */
export async function syncOnAirFromVmix(connectionId: string, sessionId: string) {
  const { target } = await targetFor(connectionId)
  const state = await getState(target)

  const mappings = await db.vmixInputMapping.findMany({
    where: { connectionId, sessionId },
    select: { participantId: true, inputNumber: true, inputKey: true },
  })
  if (mappings.length === 0) return { changed: 0, activeNumber: state.activeNumber }

  const liveNumbers = new Set<number>()
  if (state.activeNumber !== null) liveNumbers.add(state.activeNumber)
  for (const n of state.overlayInputNumbers) liveNumbers.add(n)

  let changed = 0
  for (const mapping of mappings) {
    // Le numéro d'entrée peut avoir changé : on le réaligne sur le GUID, qui est
    // stable, avant de comparer.
    const current = state.inputs.find((i) => i.key === mapping.inputKey)
    const number = current?.number ?? mapping.inputNumber
    const onAir = number !== null && number !== undefined && liveNumbers.has(number)

    const existing = await db.participant.findUnique({
      where: { id: mapping.participantId },
      select: { onAir: true, onAirSource: true },
    })
    if (!existing) continue
    if (existing.onAir === onAir && existing.onAirSource === 'VMIX') continue

    await db.participant.update({
      where: { id: mapping.participantId },
      data: { onAir, onAirSource: 'VMIX' },
    })
    if (number !== null && number !== undefined && current && current.number !== mapping.inputNumber) {
      await db.vmixInputMapping.updateMany({
        where: { connectionId, participantId: mapping.participantId },
        data: { inputNumber: current.number },
      })
    }
    publish(sessionTopic(sessionId), {
      type: 'participant.onair',
      participantId: mapping.participantId,
      onAir,
      source: 'VMIX',
    })
    changed += 1
  }
  return { changed, activeNumber: state.activeNumber }
}

/** Commande audio sur l'entrée d'un correspondant (mute dans vMix, pas chez lui). */
export async function participantAudio(
  user: AuthedUser,
  input: {
    connectionId: string
    participantId: string
    action: 'AudioOn' | 'AudioOff' | 'SetVolume' | 'AudioBusOn' | 'AudioBusOff'
    value?: string
  },
) {
  const { target, connection } = await targetFor(input.connectionId)
  const mapping = await db.vmixInputMapping.findFirst({
    where: { connectionId: connection.id, participantId: input.participantId },
  })
  if (!mapping) {
    throw new HttpError(
      409,
      "Ce correspondant n'est associé à aucune entrée vMix. Associez-le d'abord.",
    )
  }

  if (
    input.action === 'AudioBusOn' &&
    input.value &&
    connection.returnBuses.some((bus) => bus.toUpperCase() === input.value?.toUpperCase())
  ) {
    throw new HttpError(
      409,
      `Le bus ${input.value} est déclaré comme bus de retour. Y ajouter un ` +
        "correspondant casserait le mix-minus : il s'entendrait lui-même.",
      'mixminus_violation',
    )
  }

  try {
    const result = await callFunctionSerialized(target, input.action, {
      input: mapping.inputKey,
      ...(input.value !== undefined ? { value: input.value } : {}),
      returnBuses: connection.returnBuses,
    })
    await audit({
      action: `vmix.${input.action}`,
      actorId: user.id,
      actorLabel: user.displayName,
      target: input.participantId,
      detail: { inputKey: mapping.inputKey, value: input.value ?? null },
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await db.vmixInputMapping.update({
      where: { id: mapping.id },
      data: { lastError: message.slice(0, 300) },
    })
    if (error instanceof VmixError) throw error
    throw error
  }
}
