# Lucarne — Cahier des charges

Nov 16, 2026 · @Zacharie

## Vision

Lucarne est un moteur de jeu pixel art open source où tout se passe au même endroit : on dessine, on compose, on code et on joue sans jamais exporter un fichier.

Le problème de départ : avec Unity, chaque retouche demande de sortir du logiciel, d'exporter, de réimporter et de vérifier que tout est bien pris en compte. Cette friction finit par faire abandonner les projets.

Lucarne répond avec une idée simple : le jeu est un dossier de fichiers simples dans Git, et l'éditeur est une fenêtre dessus, sur Mac comme sur iPad. Inspiré du workflow de PICO-8, sans ses limites de résolution, de couleurs ni de code.

## Principes

1. **Zéro export.** Ce qu'on dessine est enregistré sur disque et visible dans le jeu, sans autre logiciel.
2. **Des fichiers simples.** PNG, JSON et TypeScript, lisibles par un humain, par Git et par une IA.
3. **Pensé pour l'IA.** Le code et les cartes sont écrits pour être compris et modifiés par Claude Code.
4. **Pixel-perfect.** 1 pixel dessiné = 1 pixel à l'écran, sur le sol comme sur les murs.
5. **Hors ligne d'abord.** On dessine sur l'iPad sans réseau, on synchronise ensuite.
6. **Des contraintes qui aident, pas qui brident.** Palette et résolution par projet, sans limites artificielles.
7. **Open source (MIT).** Construit d'abord pour un usage perso, publié pour tous.

## Architecture

Trois pièces : le moteur (un dépôt open source), le jeu (un autre dépôt qui l'utilise) et l'éditeur (une web app qui ouvre le dossier du jeu). Git est le seul système de synchronisation.

&#91;embedded content: architecture · Mac, iPad, GitHub et moteur\]

Les deux appareils ont la même copie du dossier et le même éditeur ; seul le Mac a Claude Code, et GitHub relie le tout.

**Le moteur** contient le rendu, les collisions, les sprites, les cartes, l'audio et l'éditeur web. Le jeu utilise toujours sa dernière version. Licence MIT.

**Le jeu** est un dossier de fichiers simples :

```
mon-jeu/
  sprites/   PNG + JSON (animations, directions)
  maps/      JSON (tuiles par hauteur, entités) + PNG de retouche
  music/     JSON (partitions chiptune)
  code/      TypeScript (logique, dialogues)
  AGENTS.md  l'API du moteur expliquée à l'IA
```

**L'éditeur** est la même web app partout, installée sur l'écran d'accueil de l'iPad ou dans le Dock du Mac. Elle lit et écrit une copie de travail locale du dépôt :

| Appareil | Copie de travail | IA | Synchro |
| --- | --- | --- | --- |
| Mac | Vrai dossier sur disque, via un serveur local (`npx lucarne dev`) | Claude Code dans le même dossier | `git push` / `pull` ou bouton Sync |
| iPad | Système de fichiers privé du navigateur (OPFS), hors ligne | Aucune en v1 | Bouton Sync (pull + push via l'API GitHub) |

- **Authentification GitHub :** un jeton personnel *fine-grained*, limité au dépôt du jeu, collé une fois par appareil et gardé dans le stockage du navigateur.
- **Synchro différentielle :** seuls les fichiers dont l'empreinte (SHA) a changé sont téléchargés ou envoyés, en un commit groupé.
- **Conflits :** rares en solo. L'app garde les deux versions et laisse choisir.
- **Stockage persistant :** l'app demande `navigator.storage.persist()`, et les web apps installées échappent au nettoyage automatique de Safari.

## Rendu 2.5D

Le monde est en 3D sous le capot, rendu en 320×180 pixel-perfect avec une caméra fixe. Le tampon de profondeur règle l'ordre d'affichage pixel par pixel : ponts, étages, balles en hauteur et rayons qui traversent plusieurs niveaux s'affichent correctement, sans astuce.

- **Résolution :** 320×180, tuiles de 16 px, mise à l'échelle entière sans lissage. Réglable par projet.
- **Projection oblique** (orthographique + cisaillement) : le sol, le dessus des blocs et la face avant des murs s'affichent tous à 1:1. Les faces latérales et arrière ne sont pas visibles, comme dans un Zelda 2D.
- **Tuiles avec hauteur :** chaque case de la carte a une hauteur, et le moteur génère les blocs 3D texturés avec les tuiles pixel art. Aucune modélisation.
- **Murs rabattus :** réglage par mur. Pour la logique, le mur reste vertical (il bloque joueur et balles). Pour le rendu, sa face intérieure est couchée vers l'extérieur, à 1:1, façon salle de Zelda. Utilisé pour les murs sud, est et ouest des salles de donjon.
- **Sprites :** des panneaux plats dessinés pour l'angle de la caméra, calés sur la grille de pixels.
- **Ombres simples :** une ombre ronde sous chaque personnage et projectile, qui permet aussi de lire la hauteur d'un saut ou d'une balle.
- **Technologie :** WebGL via three.js, avec une matrice de caméra construite à la main.
- **Pas de rotation de caméra** en v1. Le mode HD (rendu à la résolution de l'écran, rotation libre) reste possible plus tard comme simple réglage de projet.

## Éditeur pixel art

C'est la première brique construite. Il doit être confortable au stylet sur iPad, hors ligne, et à la souris sur Mac.

**Dessin**

- Outils de base : crayon, gomme, pot de peinture, pipette, ligne, rectangle.
- Sélection + déplacement (copier, retourner).
- Palette imposée par projet, partagée par tous les sprites.
- Pas de calques.
- Annulation illimitée pendant la session.

**Stylet (iPad)**

- Seuls les événements stylet dessinent ; la paume est ignorée.
- Les doigts servent aux gestes : deux doigts pour zoomer et déplacer, tap à deux doigts pour annuler.
- Canvas en `touch-action: none`, sans sélection de texte ni menu d'appui long.

**Animation**

- Images successives avec pelure d'oignon.
- **Sprites directionnels :** l'asset sait quelles directions sont dessinées et lesquelles sont générées en miroir (par exemple bas, bas-droite, droite, haut-droite, haut).
- **Armes en 8 ou 16 directions :** on dessine 0° et 45° (plus 22,5° pour 16 directions). Le reste est généré par rotations de 90° et miroirs, sans aucune déformation. L'éditeur propose un brouillon RotSprite des angles en biais, à retoucher.

**Édition en jeu et rechargement**

- Mettre le jeu en pause, cliquer un sprite, le modifier sur place.
- Images et sons se mettent à jour en direct dans le jeu qui tourne. Le code et les cartes sont pris au prochain lancement.

**Format :** PNG + un JSON par sprite (images, durées, directions). Pas de format Aseprite.

**Choix techniques** (décidés le 16 nov. 2026)

- **Stack :** Vite + TypeScript, sans framework. Canvas géré à la main, interface en DOM.
- **Stockage :** une couche abstraite. Sur Mac, `npx lucarne dev` écrit dans le vrai dossier ; sur iPad, OPFS hors ligne. L'étape 2 n'ajoute que le bouton Sync.
- **Planche PNG :** un seul PNG RGBA par sprite, en grille : une ligne par direction dessinée, une colonne par image. Le JSON décrit la taille d'une case, les directions et la durée de chaque image.
- **Palette :** `palette.json` à la racine du jeu, une liste de couleurs hex. Les pixels sont stockés en couleurs réelles (pas de PNG indexé) ; changer une couleur propose de la remplacer dans tous les sprites. Avertissement au-delà de 32 couleurs.
- **Taille des sprites :** libre (jusqu'à 512 px), 16×16 par défaut, raccourcis 8, 16, 32 et 64.
- **Interface :** outils à gauche, palette et sprites à droite, canvas au centre, pensée pour l'iPad en paysage.
- **Livraisons :** d'abord le dessin (outils, palette, sélection, annulation, stylet, enregistrement), puis l'animation (images, pelure d'oignon, directions, armes et RotSprite).

## Éditeur de cartes

Les cartes combinent des tuiles avec hauteur pour la structure, une couche de retouche libre pour l'âme du lieu, et des entités placées à la main. Le format est lisible en texte, pour que Claude Code puisse modifier une scène aussi facilement que l'éditeur.

- **Tuiles avec hauteur :** on peint le sol et on monte des niveaux (falaises, estrades, murets). La tuile *est* la géométrie et la collision.
- **Auto-tiling :** bords et coins se placent tout seuls selon les voisins.
- **Couche de retouche :** un PNG par carte, superposé au sol, au dessus des blocs et à la face avant des murs. On peint directement sur l'image du jeu : le moteur retrouve la surface et le pixel touchés. Un mode « murs transparents » permet de peindre le sol caché.
- **Décors libres :** rochers, herbes, débris posés hors grille, avec leur propre profondeur.
- **Entités :** ennemis, coffres, portes, PNJ, glissés-déposés sur la carte. Un panneau affiche leurs réglages, déclarés dans le code.
- **Monde :** une grande carte extérieure qui défile, plus des cartes plus petites (donjon, intérieurs) reliées par des portes.

**Format d'une carte** — une grille de caractères par niveau de hauteur et une liste d'entités nommées :

```json
{
  "tiles": {
    "h0": ["##########",
           "#........#",
           "#...~~...#",
           "####..####"],
    "h1": ["..........",
           ".##......."]
  },
  "entities": [
    { "id": "bat1",  "type": "Bat",   "x": 3, "y": 2 },
    { "id": "chest", "type": "Chest", "x": 8, "y": 1, "loot": "key" },
    { "id": "door",  "type": "Door",  "x": 4, "y": 3, "locked": true }
  ]
}
```

## Audio

Toute la musique et les bruitages sont synthétisés en direct par la Web Audio API à partir de partitions JSON. Un morceau pèse quelques Ko, et Git voit chaque note modifiée.

- **Éditeur de musique en v1**, style *piano roll* (inspiré de BeepBox) : des notes sur une grille, confortable au stylet.
- **Sons chiptune :** formes d'onde simples (carré, triangle, dents de scie, bruit) sur un petit nombre de canaux.
- **Bruitages** générés par paramètres, dans l'esprit de ZzFX (tir, impact, explosion, ramassage).
- **Rechargement en direct :** une mélodie modifiée reprend au même endroit, un bruitage modifié s'entend au prochain déclenchement.
- **Mélodies du domaine public :** les airs traditionnels (comme *La Blanche Biche*) peuvent être retranscrits librement depuis une source ancienne, jamais depuis un enregistrement ou un arrangement moderne.

## Code du jeu et API

La logique s'écrit en TypeScript, avec une API pensée pour qu'une IA la comprenne au premier coup d'œil : explicite, typée, et tout ce qui concerne une entité dans un seul fichier. En v1, l'IA est Claude Code, qui travaille directement dans le dossier du jeu sur le Mac.

**Entités : objets simples + comportements réutilisables**

```ts
class Bat extends Entity {
  sprite = "bat"
  traits = [Health(2), Knockback(), DropsLoot("heart", 0.3)]

  update() {
    this.flyTowards(player, 40)
  }
}
```

- Des briques prêtes à l'emploi : vie, recul, butin, collisions, clignotement d'invincibilité.
- Les réglages modifiables d'une entité sont déclarés dans sa classe. L'éditeur de cartes en tire son panneau de propriétés, et l'IA sait ce qui est valide.
- Pas d'ECS : une salle compte quelques dizaines d'entités, la lisibilité prime.

**Projectiles :** un système dédié et optimisé pour des centaines de balles, avec des motifs prêts à l'emploi (rafale, spirale, cercle). Chaque balle a une hauteur : basse, elle passe sous un joueur qui saute ; haute, elle le touche.

**Game feel en une ligne :** tremblement d'écran, gel d'image à l'impact, recul, flash.

**Dialogues : scripts asynchrones dans le code**

```ts
async talkTo() {
  await say(this, "Le donjon est au nord.")
  const r = await choose(["J'y vais.", "Plus tard."])
  if (r === 0) player.give("key")
}
```

**Rechargement :** quand du code change, l'éditeur affiche « Code modifié », et la nouvelle version est prise au prochain lancement du jeu. Pas de rechargement à chaud du code.

**Documentation pour l'IA :** un `AGENTS.md` généré dans chaque jeu décrit l'API du moteur, les traits disponibles et les formats de fichiers.

## Jeu test

Lucarne grandit autour d'un petit jeu : un monde à explorer et un donjon fait main, avec des combats twin-stick à la *Enter the Gungeon*. Une fonctionnalité n'entre dans le moteur que si ce jeu en a besoin.

**Contenu**

- Un monde extérieur qui défile, avec quelques PNJ et leurs dialogues.
- Un donjon unique, conçu salle par salle, avec des murs rabattus.
- Portes verrouillées, clés, interrupteurs, un objet spécial.
- Inventaire et objets.
- Un boss en fin de donjon.

**Combat**

- Visée libre : à la souris, ou au stick droit avec une aide à la visée discrète. Le jeu bascule tout seul selon l'appareil utilisé.
- Le personnage regarde vers la visée, l'arme tourne en 8 ou 16 directions.
- Saut d'esquive : on passe au-dessus des balles basses, on monte sur les rebords.
- La caméra reste fixe et se décale légèrement vers la visée.
- Interface (vie, munitions, inventaire, menus) dessinée en pixel art dans le rendu 320×180.

**Contrôles**

| Appareil | Déplacement | Visée / tir | Saut |
| --- | --- | --- | --- |
| Mac | Clavier (ZQSD) ou stick gauche | Souris ou stick droit | Touche ou bouton dédié |
| iPad (test) | Stick virtuel gauche | Stick virtuel droit | Bouton tactile |

**Outils de test** pendant que le jeu tourne

- Afficher les hitbox (collisions et dégâts).
- Téléportation vers une salle et mode invincible.

## Périmètre et feuille de route

La v1 est atteinte quand le jeu test est jouable du début à la fin, entièrement créé dans Lucarne. Il n'y a pas de contrainte de temps, mais chaque étape se termine par quelque chose de jouable ou d'utilisable.

**Étapes**

1. **Éditeur pixel art** : dessin au stylet hors ligne, palette, sélection, animation, pelure d'oignon, enregistrement dans le dossier.
2. **Synchro** : copie locale (disque sur Mac, OPFS sur iPad), bouton Sync vers GitHub.
3. **Premier rendu** : un sprite animé qui se déplace sur une carte plate, en 320×180 avec la projection oblique.
4. **Cartes** : tuiles avec hauteur, auto-tiling, entités, couche de retouche, murs rabattus.
5. **Gameplay** : entités et traits, projectiles, saut, visée, collisions en hauteur, outils de test.
6. **Audio** : bruitages, puis éditeur de musique piano roll.
7. **Jeu test complet** : monde, donjon, PNJ, boss, interface pixel art.

**Hors v1**

- Export en app de bureau (.app, .exe) : en v1, le jeu se joue dans le navigateur.
- Objets low poly (primitives, import glTF).
- Mode HD et rotation libre de la caméra.
- Lumières dynamiques.
- IA intégrée à l'éditeur (chat avec clé d'API), notamment pour l'iPad.
- Dialogues au format Ink, pour les jeux très narratifs.
- Calques et import Aseprite.
- Versions figées du moteur, le jour où d'autres l'utilisent.

## Questions ouvertes

Six points restent à trancher. Chacun a une recommandation ; la colonne Décision est à remplir.

| Question | Options | Recommandation | Décision |
| --- | --- | --- | --- |
| Unité de hauteur | Un cran = 8 px ou 16 px | 8 px : marches et murets plus fins, un mur = 2 crans |  |
| Caméra dans le donjon | Salle par salle (Zelda, Isaac) ou défilement continu (Gungeon) | Salle par salle : salles lisibles, cohérent avec les murs rabattus |  |
| Animations | Durée par image ; hitbox éditables image par image | Durée par image en v1, hitbox par image pour les attaques de boss |  |
| Palette | Taille maximale ou libre | Libre, avec un avertissement au-delà de 32 couleurs |  |
| Sauvegarde du joueur | Points de sauvegarde, automatique, aucune | Automatique à l'entrée de chaque salle |  |
| Distribution du moteur | Paquet npm ou moteur copié dans chaque jeu | Paquet npm (`lucarne`), toujours en dernière version |  |
