import type { EngineCapabilities, QualityProfile } from '@/lib/media/engine'
import type { Capability } from '@/lib/rbac'

export interface SessionSummary {
  id: string
  name: string
  state: 'SCHEDULED' | 'LIVE' | 'ENDED'
  productionName: string
  roomName: string
  returnStreamId: string
}

export interface VmixMappingSummary {
  connectionId: string
  inputKey: string
  inputNumber: number | null
  inputTitle: string | null
  lastError: string | null
}

export interface ParticipantSummary {
  id: string
  displayName: string
  role: string
  state: 'INVITED' | 'READY' | 'CONNECTING' | 'LIVE' | 'DISCONNECTED' | 'REVOKED'
  streamId: string
  onAir: boolean
  onAirSource: 'MANUAL' | 'VMIX'
  micAllowed: boolean
  cameraAllowed: boolean
  qualityProfile: 'ECONOMY' | 'STANDARD' | 'BROADCAST' | 'HIGH'
  returnBus: string | null
  /** URL de notre page de sortie, à coller dans un Web Browser Input vMix. */
  vmixUrl: string
  mapping: VmixMappingSummary | null
}

export interface VmixConnectionSummary {
  id: string
  label: string
  host: string
  port: number
  mode: 'DIRECT' | 'AGENT'
  lastStatus: string | null
  lastCheckedAt: string | null
  returnBuses: string[]
}

export interface EventRow {
  id: string
  type: string
  message: string | null
  participantId: string | null
  at: string
}

export interface ControlRoomProps {
  session: SessionSummary
  participants: ParticipantSummary[]
  /** Canal de supervision en disposition multiview. */
  directorUrl: string
  /** Même canal, interface complète du moteur : trappe de secours. */
  directorFullUrl: string
  engineOrigin: string
  capabilities: EngineCapabilities
  userCapabilities: Capability[]
  qualityProfiles: QualityProfile[]
  vmixConnections: VmixConnectionSummary[]
  returnPublisherPath: string
  initialEvents: EventRow[]
}
