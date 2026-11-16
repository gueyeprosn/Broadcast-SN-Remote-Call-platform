import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  auditCutoff,
  DAY_MS,
  purgeAfter,
  resolvePolicy,
  sessionCutoff,
  staleLiveCutoff,
} from '../src/lib/retention-policy.ts'

const NOW = new Date('2026-11-16T12:00:00.000Z')

test('la politique par defaut ne purge jamais le journal d audit', () => {
  const policy = resolvePolicy(30, 0)
  assert.equal(policy.sessionDays, 30)
  // null et non 0 : « jamais » n'est pas « immediatement ».
  assert.equal(policy.auditDays, null)
  assert.equal(auditCutoff(policy, NOW), null)
})

test('une fenetre d audit explicite est prise en compte', () => {
  const policy = resolvePolicy(30, 365)
  assert.equal(policy.auditDays, 365)
  const cutoff = auditCutoff(policy, NOW)
  assert.ok(cutoff)
  assert.equal(NOW.getTime() - cutoff.getTime(), 365 * DAY_MS)
})

test('la date de purge est calculee depuis la fin de session, pas depuis maintenant', () => {
  const policy = resolvePolicy(30, 0)
  const endedAt = new Date('2026-10-01T08:30:00.000Z')
  assert.equal(
    purgeAfter(policy, endedAt).toISOString(),
    new Date('2026-10-31T08:30:00.000Z').toISOString(),
  )
})

test('la limite de session recule exactement du nombre de jours configure', () => {
  for (const days of [1, 7, 30, 90, 3650]) {
    const policy = resolvePolicy(days, 0)
    assert.equal(NOW.getTime() - sessionCutoff(policy, NOW).getTime(), days * DAY_MS)
  }
})

test('une session en direct est jugee oubliee au-dela de 24 h', () => {
  assert.equal(NOW.getTime() - staleLiveCutoff(NOW).getTime(), DAY_MS)
})

test('reduire la duree de conservation rend des sessions immediatement eligibles', () => {
  // Une session terminee il y a 45 jours : conservee a 90 jours, due a 30.
  const endedAt = new Date(NOW.getTime() - 45 * DAY_MS)
  const long = resolvePolicy(90, 0)
  const short = resolvePolicy(30, 0)
  assert.ok(purgeAfter(long, endedAt) > NOW, 'a 90 jours elle doit encore etre conservee')
  assert.ok(purgeAfter(short, endedAt) < NOW, 'a 30 jours elle doit etre due')
})
