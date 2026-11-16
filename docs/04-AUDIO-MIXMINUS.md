# Retour programme, talkback et mix-minus

## 0. Avertissement liminaire

**vMix Call fournit un mix-minus automatique à ses propres participants. Les entrées
Web Browser n'en bénéficient pas.** Une entrée Web Browser est une source audio
ordinaire. Si vous renvoyez le Master vers les correspondants, chaque correspondant
s'entend lui-même avec la latence du tour complet : c'est inexploitable à l'antenne.

Le mix-minus décrit ici est donc **construit explicitement**, bus par bus. Rien n'est
automatique.

## 1. Les quatre bus

| Bus | Contenu | Destination |
|---|---|---|
| **PGM** (Master vMix) | l'émission diffusée | diffusion / enregistrement |
| **RETOUR** (Bus A) | PGM **moins** les correspondants | page `/return/<sessionId>` → tous les correspondants |
| **TALKBACK** (Bus B) | micro réalisateur seul | un correspondant à la fois, via `soloChat` |
| **RETOUR INDIVIDUEL** (Bus C…G) | PGM moins *ce* correspondant | un correspondant nommé |

## 2. Montage de référence dans vMix (2 à 6 correspondants)

### 2.1 Bus A = retour programme commun

*Settings → Audio Outputs* : activer le **Bus A**.

Pour **chaque** entrée Web Browser de correspondant :
- `AudioBusOn  Value=M  Input=<n>`  → le correspondant part bien à l'antenne
- `AudioBusOff Value=A  Input=<n>`  → **mais pas dans le retour**

Pour **toutes les autres** sources (plateau, tapis, jingles, invités en studio) :
- `AudioBusOn Value=M Input=<n>`
- `AudioBusOn Value=A Input=<n>`

Bus A contient alors : l'émission **sans aucun correspondant**.

> Un correspondant n'entend donc pas les autres correspondants par ce chemin.
> S'ils doivent se parler, c'est l'audio de salle du moteur média qui s'en charge
> (les correspondants restent dans la même `room`). Les deux chemins coexistent :
> **ne jamais activer les deux pour la même voix**, sinon doublement.

### 2.2 Retour individuel (quand un correspondant doit entendre les autres)

Avec 2 correspondants A et B qui doivent dialoguer :
- Bus B = PGM − A  → destiné à A
- Bus C = PGM − B  → destiné à B

Soit, pour l'entrée de A : `AudioBusOff Value=B`, `AudioBusOn Value=C`.
Et pour l'entrée de B : `AudioBusOn Value=B`, `AudioBusOff Value=C`.

Chaque bus alimente une page `/return/<sessionId>?bus=B` publiée sous un `streamId`
distinct ; le correspondant reçoit celui qui lui est affecté par la régie.
Le nombre de retours individuels est **limité par le nombre de bus vMix (A–G, soit 7)**.
Au-delà, il faut passer par un mélangeur audio externe. C'est une limite de vMix,
pas de l'application.

### 2.3 Publication du retour — pourquoi pas depuis vMix

La documentation vMix ne garantit **pas** les autorisations micro/caméra dans le Web
Browser Input (`01-AUDIT.md` §4.1, risque R2). On ne publie donc pas depuis vMix.

Chaîne retenue, entièrement documentée :

```
vMix Bus A ──► Audio Output = câble audio virtuel (VB-CABLE / Voicemeeter)
                               │
Chrome sur le PC de régie ─────┘  page /return/<sessionId>
   micro sélectionné = "CABLE Output"
   publie  push=<returnStreamId>  &novideo  (ou avec NDI→caméra virtuelle pour la vidéo)
                               │
                   Salle média ▼
                   Correspondants : view=<returnStreamId>&solo
```

Pour le **retour vidéo** : vMix *NDI Output* ou *Virtual Output* → caméra virtuelle,
sélectionnée comme `&videodevice` sur la page `/return`. Sans cela, le retour est
audio seul, ce qui suffit dans la majorité des directs.

La page `/return` applique `&proaudio` : elle désactive l'annulation d'écho, la
réduction de bruit et l'auto-nivellement. Sur un bus de programme c'est indispensable —
ces traitements sont conçus pour une voix au micro, pas pour un mixage d'émission.

## 3. Talkback

Le talkback **ne passe pas par vMix** et ne touche jamais le Master. Il utilise le
canal privé du moteur :

- `{"action":"soloChat", "target":"<streamId>"}` → la régie parle au correspondant,
  unidirectionnel.
- `{"action":"soloChatBidirectional", "target":"<streamId>"}` → échange privé.

Garde-fous implémentés :
1. Le talkback est **momentané** : bouton maintenu (push-to-talk) ; au relâchement,
   la commande inverse est envoyée. Pas d'état « talkback resté ouvert ».
2. Un **seul** correspondant en talkback à la fois. Activer un second ferme le premier.
3. Un bandeau rouge « TALKBACK OUVERT · <nom> » occupe toute la largeur de la console
   tant qu'il est actif. Il est impossible de l'ignorer.
4. Le micro de talkback **n'est jamais** routé vers un bus vMix par l'application.
   Les fonctions `AudioBus*` ne sont pas accessibles pour le périphérique de talkback.
5. Fermeture automatique du talkback à `ON AIR` du correspondant concerné, si l'option
   « couper le talkback à l'antenne » est active (défaut : **active**).

> Limite documentée par VDO.Ninja : *« Opening the Mix menu turns the custom mix on,
> and closing it doesn't turn it off »* et *« Solo Talk has limits with Meshcast and
> embedded sources »*. Nous n'utilisons donc pas Meshcast sur une session où le
> talkback est requis, et la console affiche un avertissement si les deux sont activés.

## 4. Prévention des boucles

| Boucle possible | Prévention |
|---|---|
| Correspondant s'entend (retour contient sa voix) | `AudioBusOff` de son entrée sur son bus de retour (§2.1) |
| Double retour (audio de salle + bus vMix) | la console refuse d'affecter un bus de retour à un correspondant qui est aussi en audio de salle, sans confirmation explicite |
| Larsen chez le correspondant | la page `/join` **exige** un casque : si `setSinkId` indique un haut-parleur et que le micro est actif, un avertissement persistant s'affiche |
| Talkback au Program | §3 garde-fous 4 et 5 |
| PGM → RETOUR → PGM | le bus RETOUR n'est jamais renvoyé au Master (`BusXSendToMaster` interdit par l'allowlist pour les bus de retour) |

## 5. Protocole de test audio

À exécuter avant chaque mise en production du montage. Résultats réels dans
`10-TEST-REPORT.md`.

| # | Test | Attendu |
|---|---|---|
| A1 | Correspondant parle, PGM écouté au casque | voix présente, propre |
| A2 | Correspondant parle, **son propre retour** écouté | **sa voix absente** |
| A3 | Jingle lancé dans vMix | audible par le correspondant |
| A4 | Deux correspondants A et B, retours individuels | A entend B, A ne s'entend pas, et réciproquement |
| A5 | Talkback vers A | A entend la régie ; **le PGM ne contient pas la régie** |
| A6 | Talkback vers A pendant que B est à l'antenne | B n'entend pas la régie |
| A7 | Correspondant sans casque | avertissement affiché ; larsen reproduit et identifié |
| A8 | Coupure micro par la régie (`action:mic`) | silence sur le PGM **et** le correspondant voit son micro coupé |
| A9 | `AudioOff` de l'entrée vMix | silence sur le PGM, le correspondant **continue d'émettre** (vérifier qu'il n'est pas induit en erreur) |
| A10 | Fin de talkback, relâchement du bouton | canal privé fermé, vérifié par l'absence de retour régie |
