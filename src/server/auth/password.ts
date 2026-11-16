import { randomBytes, scrypt as _scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(_scrypt) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>

// Paramètres recommandés par l'OWASP pour scrypt : N=2^17, r=8, p=1.
const N = 1 << 17
const R = 8
const P = 1
const KEYLEN = 64
const MAXMEM = 256 * 1024 * 1024

export const MIN_PASSWORD_LENGTH = 12

/**
 * scrypt plutôt qu'une dépendance externe (argon2 / bcrypt) : natif Node, aucun
 * binaire à compiler dans l'image Docker, paramètres explicites et vérifiables.
 */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`)
  }
  const salt = randomBytes(16)
  const key = await scrypt(password.normalize('NFKC'), salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: MAXMEM,
  })
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$')
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const n = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (!Number.isInteger(n) || !Number.isInteger(r) || !Number.isInteger(p)) return false
  // Borne les paramètres lus en base : un enregistrement falsifié ne doit pas
  // pouvoir provoquer un déni de service par explosion mémoire.
  if (n > 1 << 20 || r > 32 || p > 8) return false
  const salt = Buffer.from(parts[4] ?? '', 'base64')
  const expected = Buffer.from(parts[5] ?? '', 'base64')
  if (salt.length === 0 || expected.length === 0) return false
  try {
    const key = await scrypt(password.normalize('NFKC'), salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: MAXMEM,
    })
    return timingSafeEqual(key, expected)
  } catch {
    return false
  }
}
