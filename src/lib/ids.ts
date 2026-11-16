import { randomBytes, createHash, timingSafeEqual } from 'node:crypto'

/**
 * Alphabet sans caractères ambigus (ni 0/O, ni 1/l/I).
 * Un correspondant dicte parfois son identifiant au téléphone pendant un direct.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'

function randomString(length: number): string {
  // Rejection sampling : évite le biais modulo d'un simple octet % 31.
  const out: string[] = []
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= 248) continue // 248 = 8 * 31, on rejette la queue
      out.push(ALPHABET[byte % ALPHABET.length]!)
      if (out.length === length) break
    }
  }
  return out.join('')
}

/** Nom de salle du moteur média. Opaque : ne révèle rien de l'émission. */
export const newRoomName = () => `snrc${randomString(12)}`

/** Secret de salle (&password côté moteur). */
export const newRoomSecret = () => randomString(24)

/**
 * Identifiant de flux d'un correspondant. Préfixe `g`, 10 caractères.
 * Immuable pour la durée de la session : c'est lui qui permet à une entrée
 * vMix de retrouver le bon correspondant après un rafraîchissement.
 */
export const newStreamId = () => `g${randomString(10)}`

/** Identifiant de flux du bus de retour programme. */
export const newReturnStreamId = () => `r${randomString(10)}`

/** Clé publique de la page /output/<key>. Distincte du streamId. */
export const newOutputKey = () => randomString(22)

/** Jeton d'invitation : 32 octets, base64url. Affiché une seule fois. */
export const newInviteToken = () => randomBytes(32).toString('base64url')

export const hashToken = (token: string) =>
  createHash('sha256').update(token, 'utf8').digest('hex')

/** Comparaison à temps constant de deux empreintes hexadécimales. */
export function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))
  } catch {
    return false
  }
}

export const slugify = (input: string) =>
  input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'production'
