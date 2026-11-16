import { SignJWT, jwtVerify, type JWTPayload } from 'jose'
import { cookies } from 'next/headers'
import { env, isProd } from '@/lib/env'
import type { Role } from '@/generated/prisma/enums'

const USER_COOKIE = 'snrc_session'
const PARTICIPANT_COOKIE = 'snrc_participant'
const ISSUER = 'broadcast-sn-remote-call'

function key(): Uint8Array {
  return new TextEncoder().encode(env().AUTH_SECRET)
}

export interface UserSession extends JWTPayload {
  scope: 'user'
  sub: string
  role: Role
  epoch: number
}

export interface ParticipantSession extends JWTPayload {
  scope: 'participant'
  sub: string // participantId
  sid: string // sessionId
  epoch: number
}

async function sign(payload: JWTPayload, ttlSeconds: number): Promise<string> {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(key())
}

async function verify<T extends JWTPayload>(token: string, scope: string): Promise<T | null> {
  try {
    const { payload } = await jwtVerify(token, key(), {
      issuer: ISSUER,
      algorithms: ['HS256'],
      clockTolerance: 5,
    })
    if (payload['scope'] !== scope) return null
    return payload as T
  } catch {
    return null
  }
}

function baseCookie() {
  return {
    httpOnly: true as const,
    sameSite: 'lax' as const,
    secure: isProd(),
    path: '/',
  }
}

// ── Session utilisateur (admin / réalisateur / technicien) ────────────────────

export const USER_SESSION_TTL = 8 * 3600

export async function createUserSession(
  userId: string,
  role: Role,
  epoch: number,
  ttlSeconds: number = USER_SESSION_TTL,
): Promise<void> {
  const token = await sign({ scope: 'user', sub: userId, role, epoch }, ttlSeconds)
  const store = await cookies()
  store.set(USER_COOKIE, token, { ...baseCookie(), maxAge: ttlSeconds })
}

export async function readUserSession(): Promise<UserSession | null> {
  const token = (await cookies()).get(USER_COOKIE)?.value
  if (!token) return null
  return verify<UserSession>(token, 'user')
}

export async function clearUserSession(): Promise<void> {
  const store = await cookies()
  store.delete(USER_COOKIE)
}

// ── Session correspondant ─────────────────────────────────────────────────────

export const PARTICIPANT_SESSION_MAX_TTL = 12 * 3600

export async function createParticipantSession(
  participantId: string,
  sessionId: string,
  epoch: number,
  ttlSeconds: number,
): Promise<void> {
  const ttl = Math.max(60, Math.min(ttlSeconds, PARTICIPANT_SESSION_MAX_TTL))
  const token = await sign(
    { scope: 'participant', sub: participantId, sid: sessionId, epoch },
    ttl,
  )
  const store = await cookies()
  store.set(PARTICIPANT_COOKIE, token, { ...baseCookie(), maxAge: ttl })
}

export async function readParticipantSession(): Promise<ParticipantSession | null> {
  const token = (await cookies()).get(PARTICIPANT_COOKIE)?.value
  if (!token) return null
  return verify<ParticipantSession>(token, 'participant')
}

export async function clearParticipantSession(): Promise<void> {
  const store = await cookies()
  store.delete(PARTICIPANT_COOKIE)
}
