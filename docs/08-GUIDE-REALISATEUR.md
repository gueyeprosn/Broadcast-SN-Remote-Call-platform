# Guide du réalisateur

---

## 1. Vocabulaire

| Terme | Sens précis |
|---|---|
| **Production** | l'émission récurrente (« Journal de 20h ») |
| **Session** | une édition. Porte sa **propre** salle média, son propre secret, ses propres invitations |
| **Correspondant** | un intervenant distant. Possède un `streamId` **immuable** pour la durée de la session |
| **Lien vMix** | l'URL de la page de sortie propre, à coller dans un Web Browser Input |
| **ON AIR** | décision de la régie, ou état réel du Program vMix. **Jamais** déduit de l'état de connexion |

Une session = une salle neuve = un secret neuf. Rien n'est réutilisé d'une édition à
l'autre : c'est délibéré.

---

## 2. Préparer une émission

### 2.1 Créer la session
`Productions → Nouvelle production` (une seule fois), puis `+ Session` pour l'édition.
Vous arrivez directement dans la régie.

### 2.2 Ajouter les correspondants
Panneau **Invitations** : un nom par correspondant. Le nom est ce que verra
l'intervenant et ce qui nommera son entrée dans vMix — mettez le vrai nom.

Le profil qualité se change à tout moment depuis la carte du correspondant.

### 2.3 Générer les liens
Choisissez d'abord la **durée de validité**, puis **Lien** sur chaque correspondant.

> **Le lien ne s'affiche qu'une fois.** Il n'est pas stocké en clair : la base ne
> contient que son empreinte. Si vous le perdez, générez-en un nouveau — c'est
> immédiat, et l'ancien reste valable jusqu'à son expiration (révoquez-le si besoin).

Chaque lien autorise 5 ouvertures par défaut : un journaliste recharge souvent sa page.

Envoyez le lien **avec** `07-GUIDE-CORRESPONDANT.md`. La demande de casque est le seul
point qui compte vraiment.

### 2.4 Préparer les entrées vMix

Chemin **garanti et documenté** :

1. Carte du correspondant → **Lien vMix** (copie l'URL).
2. Dans vMix : `Add Input → More → Web Browser`.
3. Collez l'URL. Réglez **Width 1280 / Height 720** (la résolution du profil).
4. `OK`, puis renommez l'entrée au nom du correspondant.
5. Routez l'audio selon `04-AUDIO-MIXMINUS.md` §2.

À faire **avant** l'émission. La page affiche un cadre d'attente nommé tant que le
correspondant n'est pas connecté — vous voyez donc tout de suite si l'entrée pointe au
bon endroit.

Avec une connexion vMix déclarée, le panneau **vMix** permet d'associer un
correspondant à une entrée Web Browser **existante** et de la pointer automatiquement.
La création d'entrée par l'API n'est **pas** documentée et n'est pas proposée.

### 2.5 Préparer le retour programme

Panneau **Retour programme** → copier le lien, l'ouvrir dans un **vrai Chrome** sur le
PC de régie, pas dans vMix. Détail dans `04-AUDIO-MIXMINUS.md` §2.3.

Ordre des opérations, à ne pas inverser :

1. Bus A activé dans vMix et dirigé vers le câble audio virtuel.
2. Pour chaque entrée de correspondant : `AudioBusOn M` **et** `AudioBusOff A`.
   C'est cette seconde commande qui l'empêche de s'entendre lui-même.
3. Page `/return/<session>` ouverte dans Chrome, câble virtuel sélectionné comme micro.

**Vérifiez à l'oreille** avant l'antenne : protocole A1 à A10 de
`04-AUDIO-MIXMINUS.md` §5. Dix minutes, une fois, et plus jamais de mauvaise surprise.

---

## 3. La console de régie

### 3.1 Barre supérieure

| Voyant | Signification |
|---|---|
| **N à l'antenne** | nombre de correspondants ON AIR |
| **Canal régie actif / en attente** | le canal de supervision est établi, ou non |
| **Supervision** | le flux d'événements applicatifs. En rouge, les commandes différées peuvent tarder — **les flux média continuent** |

**Démarrer** passe la session en direct. **Terminer** déconnecte tout le monde et
révoque tous les liens : la confirmation énumère les conséquences.

### 3.2 Multiview

C'est le canal de supervision lui-même, mis en forme. Choix d'ingénierie délibéré :
ce canal est **déjà** connecté à tous les invités, donc l'afficher ne coûte **aucun flux
supplémentaire** aux correspondants. Ouvrir une fenêtre de visualisation par
correspondant doublerait au contraire leur débit montant — inacceptable pour un
journaliste en 4G.

### 3.3 Carte de correspondant

Mesures affichées : résolution, images/s, débit vidéo, débit audio, pertes de paquets,
RTT.

> **« — » signifie « non mesuré », pas « zéro ».** La donnée n'a pas été remontée par
> le moteur. C'est différent de « 0 image par seconde », qui serait une panne.

Seuils d'alerte : **pertes** orange au-delà de 1 %, rouge au-delà de 3 % ;
**RTT** orange au-delà de 150 ms, rouge au-delà de 300 ms.

Le VU-mètre reflète le niveau réel. S'il est vide alors que le correspondant parle, le
moteur ne remonte pas le niveau — ce n'est pas forcément un silence : vérifiez à
l'oreille.

### 3.4 Les quatre « mute » — à ne jamais confondre

C'est le point sur lequel une régie se trompe, et il coûte une antenne.

| Action | Où | Effet | Le correspondant le voit ? |
|---|---|---|---|
| **Micro** (carte) | moteur média | coupe le **flux publié**. Il n'émet plus du tout | **Oui** |
| **Volume d'écoute** (carte) | moteur média | change ce que *lui* entend | Non |
| **AudioOff** (panneau vMix) | vMix | coupe l'entrée **dans vMix**. Il continue d'émettre | **Non** |
| Mute du bus de retour | vMix | il n'entend plus la régie | Non directement |

Conséquence pratique : **AudioOff ne coupe pas le correspondant**, il coupe ce que vous
diffusez de lui. Il continue de parler en croyant être entendu. Pour une coupure
franche et visible, utilisez **Micro**.

### 3.5 Talkback

Bouton **maintenu enfoncé** : au relâchement, le canal se referme. Pas d'état
« talkback resté ouvert ».

- **Un seul** correspondant à la fois. L'état est tenu côté serveur : deux opérateurs
  sur deux postes ne peuvent pas ouvrir deux canaux sans le savoir.
- Un **bandeau rouge pleine largeur** s'affiche tant que le canal est ouvert.
- Le talkback **ne touche jamais** le Program : l'application ne route aucun micro de
  talkback vers un bus vMix.
- Chaque ouverture et fermeture est journalisée, avec sa durée.

### 3.6 ON AIR

Deux sources, visuellement distinctes :

- **ON AIR** — votre décision (`onAirSource = MANUAL`).
- **ON AIR · vMix** — constaté dans le Program vMix (`onAirSource = VMIX`), si la case
  « ON AIR depuis vMix » est cochée dans le panneau vMix.

Sans connexion vMix, seul le mode manuel existe, et l'interface le dit.

### 3.7 Journal d'événements

Les derniers événements enregistrés. « Effacer l'affichage » ne supprime rien : le
journal reste intégralement conservé côté serveur, c'est votre trace en cas de litige.

---

## 4. Pendant l'émission

### Un correspondant décroche
1. Lisez **pertes** et **RTT** sur sa carte.
2. Pertes élevées → passez-le en profil inférieur (**Économie** en dernier recours).
3. Toujours mauvais → coupez sa caméra : **le son passe seul**, et le son est ce qui
   fait l'information.
4. Prévenez-le par **Message** ou **Talkback**.

### Un correspondant doit partir d'urgence
**Déconnecter** met fin à sa liaison. Son lien reste valable : il peut revenir.
**Révoquer** invalide définitivement son accès.

### Un lien a fuité
`Révoquer` sur le correspondant concerné. Effet immédiat : le serveur refuse sa
prochaine requête, et sa page de sortie vMix affiche « Accès révoqué » plutôt qu'une
image. Générez ensuite un nouveau lien.

### La console ne répond plus
Rechargez la page. **Les contributions et les entrées vMix ne passent pas par
l'application** : elles continuent. Vous perdez temporairement la supervision et les
commandes, pas l'antenne.

---

## 5. Après l'émission

**Terminer** la session :
- tous les correspondants sont déconnectés ;
- toutes les invitations sont révoquées ;
- les cookies des correspondants sont invalidés d'un coup (rotation de `tokenEpoch`) ;
- les pages de sortie vMix affichent « Session terminée », ce qui vous évite de
  diffuser par erreur une mire d'une émission passée ;
- une date de purge est posée : les données de session disparaissent au bout de la
  durée de conservation configurée (30 jours par défaut). Le journal d'audit, lui,
  n'est pas purgé.

Un administrateur suit tout cela depuis `Admin → Rétention` : ce qui sera supprimé,
quand, et les sessions restées « en direct » parce qu'un « Terminer » a été oublié —
elles gardent leurs liens d'invitation valables, donc elles méritent un coup d'œil.

---

## 6. Ce que l'outil ne fait pas

Dit ici une fois pour ne pas le découvrir en direct :

- **Pas de reconnexion automatique garantie.** Un correspondant coupé peut devoir
  recharger.
- **Pas de mix-minus automatique.** Il est monté bus par bus dans vMix.
- **Pas de création d'entrée vMix par l'API** : ce n'est pas documenté.
- **Pas de sortie NDI ni SRT** : une page WebRTC n'en produit pas.
- **Pas d'enregistrement** : aucun média n'est stocké.
- **Au-delà de 8 correspondants simultanés**, surveillez le poste de régie :
  c'est lui qui décode tous les flux (`11-KNOWN-LIMITS.md` §L9).
