import assert from 'node:assert/strict'
import { test } from 'node:test'
import { can, capabilitiesOf, CAPABILITIES } from '../src/lib/rbac.ts'

test('l administrateur a toutes les capacites', () => {
  assert.equal(capabilitiesOf('ADMIN').length, CAPABILITIES.length)
})

test('le realisateur invite et revoque, le technicien non', () => {
  assert.equal(can('DIRECTOR', 'invitation.create'), true)
  assert.equal(can('DIRECTOR', 'invitation.revoke'), true)
  assert.equal(can('TECHNICIAN', 'invitation.create'), false)
  assert.equal(can('TECHNICIAN', 'invitation.revoke'), false)
})

test('le technicien ne decide pas qui passe a l antenne', () => {
  assert.equal(can('TECHNICIAN', 'participant.onair'), false)
  assert.equal(can('DIRECTOR', 'participant.onair'), true)
})

test('seul l administrateur gere les connexions vMix et les comptes', () => {
  assert.equal(can('ADMIN', 'vmix.manage'), true)
  assert.equal(can('DIRECTOR', 'vmix.manage'), false)
  assert.equal(can('TECHNICIAN', 'vmix.manage'), false)
  assert.equal(can('DIRECTOR', 'user.write'), false)
})

test('le technicien pilote l audio vMix', () => {
  assert.equal(can('TECHNICIAN', 'vmix.audio'), true)
  assert.equal(can('TECHNICIAN', 'vmix.program'), false)
})
