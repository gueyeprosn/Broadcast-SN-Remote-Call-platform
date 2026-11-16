import assert from 'node:assert/strict'
import { test } from 'node:test'
import { isPrivateHost } from '../src/lib/vmix/client.ts'
import { parseVmixState } from '../src/lib/vmix/xml.ts'
import { checkFunction, isForbiddenBusRouting } from '../src/lib/vmix/functions.ts'

test('isPrivateHost accepte les adresses locales', () => {
  for (const host of [
    '127.0.0.1',
    'localhost',
    '10.0.0.5',
    '192.168.1.42',
    '172.16.0.1',
    '172.31.255.254',
    '169.254.10.1',
    'vmix-regie.local',
    '::1',
    'fd00::1',
    'fe80::1',
  ]) {
    assert.equal(isPrivateHost(host), true, `${host} devrait être privé`)
  }
})

test('isPrivateHost refuse les adresses publiques', () => {
  for (const host of [
    '8.8.8.8',
    '172.32.0.1',
    '172.15.0.1',
    '203.0.113.7',
    'vmix.example.org',
    '1.1.1.1',
  ]) {
    assert.equal(isPrivateHost(host), false, `${host} ne devrait pas être privé`)
  }
})

test('la liste blanche refuse une fonction inconnue', () => {
  const result = checkFunction('ShutdownVmix', {})
  assert.equal(result.ok, false)
  assert.match(result.reason ?? '', /liste blanche/)
})

test('BrowserNavigate exige une URL http(s) et une entrée', () => {
  assert.equal(checkFunction('BrowserNavigate', { value: 'https://a.example' }).ok, false)
  assert.equal(
    checkFunction('BrowserNavigate', { input: '1', value: 'file:///etc/passwd' }).ok,
    false,
  )
  assert.equal(
    checkFunction('BrowserNavigate', { input: '1', value: 'https://a.example/x?y=1' }).ok,
    true,
  )
})

test('SetVolume borne la valeur a 0-100', () => {
  assert.equal(checkFunction('SetVolume', { input: '1', value: '50' }).ok, true)
  assert.equal(checkFunction('SetVolume', { input: '1', value: '255' }).ok, false)
  assert.equal(checkFunction('SetVolume', { input: '1', value: '-1' }).ok, false)
})

test('AudioBusOff n accepte que les bus M et A a G', () => {
  assert.equal(checkFunction('AudioBusOff', { input: '1', value: 'A' }).ok, true)
  assert.equal(checkFunction('AudioBusOff', { input: '1', value: 'Z' }).ok, false)
})

test('AddInput est restreint au format Browser', () => {
  assert.equal(checkFunction('AddInput', { value: 'Browser|https://a.example' }).ok, true)
  assert.equal(checkFunction('AddInput', { value: 'Video|c:/x.mp4' }).ok, false)
})

test('BusXSendToMaster est interdit (anti-bouclage)', () => {
  assert.equal(isForbiddenBusRouting('BusXSendToMaster', 'A'), true)
  assert.equal(isForbiddenBusRouting('AudioBusOff', 'A'), false)
})

test('parseVmixState lit entrees, program et overlays', () => {
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<vmix>
  <version>29.0.0.70</version>
  <edition>4K</edition>
  <preview>2</preview>
  <active>3</active>
  <inputs>
    <input key="aaa-111" number="1" type="Colour" title="Fond">Fond</input>
    <input key="bbb-222" number="2" type="Browser" title="Correspondant A" />
    <input key="ccc-333" number="3" type="Browser" title="Correspondant &amp; B"></input>
  </inputs>
  <overlays>
    <overlay number="1">2</overlay>
    <overlay number="2"></overlay>
  </overlays>
</vmix>`
  const state = parseVmixState(xml)
  assert.equal(state.version, '29.0.0.70')
  assert.equal(state.edition, '4K')
  assert.equal(state.activeNumber, 3)
  assert.equal(state.previewNumber, 2)
  assert.equal(state.inputs.length, 3)
  assert.equal(state.inputs[1]?.isBrowser, true)
  assert.equal(state.inputs[0]?.isBrowser, false)
  assert.equal(state.inputs[2]?.title, 'Correspondant & B')
  assert.deepEqual(state.overlayInputNumbers, [2])
})

test('parseVmixState rejette une reponse qui n est pas du vMix', () => {
  assert.throws(() => parseVmixState('<html><body>404</body></html>'), /vmix/i)
})
