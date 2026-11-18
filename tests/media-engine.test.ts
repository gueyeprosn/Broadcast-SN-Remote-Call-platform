import assert from 'node:assert/strict'
import { test } from 'node:test'
import { VdoNinjaEngine } from '../src/lib/media/vdoninja.ts'
import { QUALITY_PROFILES } from '../src/lib/media/engine.ts'

const engine = new VdoNinjaEngine('https://vdo.ninja/')

const base = {
  roomName: 'snrcabcdefghjkm',
  roomSecret: 'secret24chars0000000000',
  streamId: 'gabcdefghjk',
}

test('l URL du correspondant est publish-only', () => {
  const url = new URL(
    engine.publisherUrl({
      ...base,
      label: 'Jean Dupont',
      profile: QUALITY_PROFILES.BROADCAST,
      micEnabled: true,
      cameraEnabled: true,
    }),
  )
  // &view sans valeur : c'est ce qui empeche le correspondant d'aspirer les
  // flux des autres invites. Avec une valeur, il demanderait un flux.
  assert.equal(url.searchParams.get('view'), '')
  assert.equal(url.searchParams.get('push'), base.streamId)
  assert.equal(url.searchParams.get('room'), base.roomName)
  assert.equal(url.searchParams.get('label'), 'Jean Dupont')
  assert.equal(url.searchParams.get('quality'), '1') // 1 = 1280x720, documente
  assert.equal(url.searchParams.has('cleanoutput'), true)
})

test('le lien correspondant demarre toujours seul, avec ou sans peripherique choisi', () => {
  // Sans autostart, le moteur affiche SA page « Join Room with… » dans la
  // vignette d'incrustation du correspondant : il croit la liaison ratee.
  const sansPeripherique = new URL(
    engine.publisherUrl({
      ...base,
      label: 'Test',
      profile: QUALITY_PROFILES.BROADCAST,
      micEnabled: true,
      cameraEnabled: true,
    }),
  )
  const avecPeripherique = new URL(
    engine.publisherUrl({
      ...base,
      label: 'Test',
      profile: QUALITY_PROFILES.BROADCAST,
      micEnabled: true,
      cameraEnabled: true,
      videoDeviceId: 'cam-1',
      audioDeviceId: 'mic-1',
    }),
  )
  assert.equal(sansPeripherique.searchParams.has('autostart'), true)
  assert.equal(avecPeripherique.searchParams.has('autostart'), true)
  assert.equal(avecPeripherique.searchParams.get('videodevice'), 'cam-1')
  assert.equal(avecPeripherique.searchParams.get('audiodevice'), 'mic-1')
})

test('le profil 480p utilise width/height car aucun palier quality ne l offre', () => {
  const url = new URL(
    engine.publisherUrl({
      ...base,
      label: 'Test',
      profile: QUALITY_PROFILES.STANDARD,
      micEnabled: true,
      cameraEnabled: true,
    }),
  )
  assert.equal(url.searchParams.has('quality'), false)
  assert.equal(url.searchParams.get('width'), '854')
  assert.equal(url.searchParams.get('height'), '480')
})

test('l URL de reception vMix est isolee et propre', () => {
  const url = new URL(
    engine.receiverUrl({ ...base, profile: QUALITY_PROFILES.BROADCAST }),
  )
  assert.equal(url.searchParams.get('view'), base.streamId)
  assert.equal(url.searchParams.has('solo'), true)
  assert.equal(url.searchParams.has('cleanoutput'), true)
  assert.equal(url.searchParams.get('room'), base.roomName)
  // Le plafond de debit est un parametre cote viewer : c'est ici qu'il va.
  assert.equal(url.searchParams.get('videobitrate'), '2500')
  assert.equal(url.searchParams.get('codec'), 'h264')
  // Un lien de reception ne doit jamais publier.
  assert.equal(url.searchParams.has('push'), false)
})

test('le bus de retour est publish-only : anti-bouclage par construction', () => {
  const url = new URL(
    engine.returnPublisherUrl({
      roomName: base.roomName,
      roomSecret: base.roomSecret,
      returnStreamId: 'rabcdefghjk',
      audioOnly: true,
    }),
  )
  assert.equal(url.searchParams.get('push'), 'rabcdefghjk')
  assert.equal(url.searchParams.get('view'), '')
  assert.equal(url.searchParams.has('novideo'), true)
  assert.equal(url.searchParams.has('proaudio'), true)
})

test('le lien director porte le role director et pas de push', () => {
  const url = new URL(
    engine.directorUrl({ roomName: base.roomName, roomSecret: base.roomSecret }),
  )
  assert.equal(url.searchParams.get('director'), base.roomName)
  assert.equal(url.searchParams.has('push'), false)
})

test('le multiview s obtient par parametres documentes, pas par CSS injecte', () => {
  // Constate sur la page reelle : avec ces parametres, #directorlayout passe en
  // display:none, #gridlayout devient le conteneur visible, et aucun bouton du
  // moteur ne reste affiche.
  const url = new URL(
    engine.directorUrl({ roomName: base.roomName, roomSecret: base.roomSecret }),
  )
  for (const flag of ['previewmode', 'cleandirector', 'hidesolo', 'hidecodirectors', 'nocontrols']) {
    assert.equal(url.searchParams.has(flag), true, `${flag} attendu sur le lien director`)
  }
})

test('la trappe de secours rend l interface complete du moteur', () => {
  // Si une commande de la console cessait de passer en pleine emission,
  // l'operateur doit pouvoir reprendre la main avec l'interface native.
  const url = new URL(
    engine.directorUrl({
      roomName: base.roomName,
      roomSecret: base.roomSecret,
      preview: false,
    }),
  )
  assert.equal(url.searchParams.has('previewmode'), false)
  // Le reste du nettoyage demeure : on ne veut pas des liens d'invitation du
  // moteur, meme en mode secours.
  assert.equal(url.searchParams.has('cleandirector'), true)
  assert.equal(url.searchParams.get('director'), base.roomName)
})

test('le secret de salle est percent-encode', () => {
  const url = engine.publisherUrl({
    roomName: 'room',
    roomSecret: 'a b&c=d',
    streamId: 'gx',
    label: 'A&B',
    profile: QUALITY_PROFILES.ECONOMY,
    micEnabled: true,
    cameraEnabled: true,
  })
  assert.ok(url.includes('password=a%20b%26c%3Dd'))
  assert.ok(url.includes('label=A%26B'))
  assert.equal(new URL(url).searchParams.get('password'), 'a b&c=d')
})

test('les capacites declarees ne promettent rien de faux', () => {
  // vMix Call fournit un mix-minus a SES participants ; une entree Web Browser
  // n'en beneficie pas, et VDO.Ninja ne l'applique pas automatiquement.
  assert.equal(engine.capabilities.nativeMixMinus, false)
  // La reconnexion automatique n'est pas garantie par le moteur.
  assert.equal(engine.capabilities.guaranteedReconnect, false)
  assert.equal(engine.capabilities.ndiOutput, false)
  assert.equal(engine.capabilities.srtOutput, false)
})

test('les commandes invite correspondent au contrat reel du moteur', () => {
  assert.deepEqual(engine.encodeGuestCommand('gx', { kind: 'mic', value: false }), {
    action: 'mic',
    target: 'gx',
    value: false,
  })
  assert.deepEqual(engine.encodeGuestCommand('gx', { kind: 'hangup' }), {
    action: 'hangup',
    target: 'gx',
    value: null,
  })
  assert.deepEqual(
    engine.encodeGuestCommand('gx', { kind: 'talkback', bidirectional: true }),
    { action: 'soloChatBidirectional', target: 'gx', value: null },
  )
  // Le volume est borne a 0-200 comme le documente l'API.
  assert.deepEqual(engine.encodeGuestCommand('gx', { kind: 'volume', value: 999 }), {
    action: 'volume',
    target: 'gx',
    value: 200,
  })
})

test('les commandes sur soi distinguent micro publie et ecoute locale', () => {
  // {mic} coupe le flux publie ; {mute} coupe seulement l'ecoute locale.
  assert.deepEqual(engine.encodeSelfCommand({ kind: 'mic', value: false }), { mic: false })
  assert.deepEqual(engine.encodeSelfCommand({ kind: 'speakerMute', value: true }), {
    mute: true,
  })
})
