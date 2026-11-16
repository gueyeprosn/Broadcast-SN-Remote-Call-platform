import assert from 'node:assert/strict'
import { test } from 'node:test'
import { hashPassword, verifyPassword } from '../src/server/auth/password.ts'
import { hashToken, newStreamId, newOutputKey, safeEqualHex, slugify } from '../src/lib/ids.ts'

test('un mot de passe correct est verifie, un faux est rejete', async () => {
  const hash = await hashPassword('correct horse battery')
  assert.match(hash, /^scrypt\$131072\$8\$1\$/)
  assert.equal(await verifyPassword('correct horse battery', hash), true)
  assert.equal(await verifyPassword('correct horse batterz', hash), false)
})

test('deux hachages du meme mot de passe diffèrent (sel aleatoire)', async () => {
  const a = await hashPassword('mot de passe long')
  const b = await hashPassword('mot de passe long')
  assert.notEqual(a, b)
})

test('un mot de passe trop court est refuse', async () => {
  await assert.rejects(() => hashPassword('court'), /12 caractères/)
})

test('un enregistrement falsifie ne provoque pas d explosion memoire', async () => {
  // N demesure : doit etre refuse sans tenter le calcul.
  assert.equal(await verifyPassword('x', 'scrypt$999999999$8$1$AAAA$AAAA'), false)
  assert.equal(await verifyPassword('x', 'bcrypt$1$1$1$AAAA$AAAA'), false)
  assert.equal(await verifyPassword('x', 'nimporte quoi'), false)
})

test('les identifiants de flux sont uniques et sans caracteres ambigus', () => {
  const ids = new Set(Array.from({ length: 500 }, () => newStreamId()))
  assert.equal(ids.size, 500)
  for (const id of ids) {
    assert.match(id, /^g[abcdefghjkmnpqrstuvwxyz23456789]{10}$/)
  }
})

test('les cles de sortie sont distinctes des identifiants de flux', () => {
  assert.notEqual(newOutputKey().length, newStreamId().length)
  assert.equal(newOutputKey().length, 22)
})

test('safeEqualHex compare sans fuite de longueur', () => {
  const a = hashToken('jeton')
  assert.equal(safeEqualHex(a, hashToken('jeton')), true)
  assert.equal(safeEqualHex(a, hashToken('autre')), false)
  assert.equal(safeEqualHex(a, 'abc'), false)
})

test('slugify normalise les accents', () => {
  assert.equal(slugify('Édition Spéciale — 20h'), 'edition-speciale-20h')
  assert.equal(slugify('!!!'), 'production')
})
