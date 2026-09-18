# Swap or Die 🎮

Jeu multijoueur en ligne : **ton corps change de propriétaire toutes les 25–45 secondes** (SWAP global). Survis avec 3 vies malgré les échanges de corps, fouille les coffres, récolte des ressources, fabrique des armes et pose des pièges pour éliminer les autres joueurs — pendant qu'ils essayent de faire pareil avec le corps que tu contrôles maintenant.

## Lancer le jeu

```bash
npm install        # la première fois (express + socket.io)
npm start          # démarre le serveur sur http://localhost:3000
```

Ouvre ensuite **http://localhost:3000** dans ton navigateur.

### Créer un compte

- Choisis un pseudo (3–16 caractères) et un mot de passe — c'est tout.
- **Le premier compte créé devient administrateur** (accès au panneau admin via la page `/admin.html`, ou code Konami ↑↑↓↓←→←→BA sur le menu).
- Les comptes, niveaux, cosmétiques, amis et statistiques sont sauvegardés dans `data/db.json` (créé automatiquement).

## Modes de jeu

| Mode | Description |
|---|---|
| **Partie publique** | 2 à 15 joueurs, démarrage automatique dès 2 joueurs présents |
| **Salon privé** | 2 à 15 joueurs, accessible par code (ex. `A1B2C3`), l'hôte démarre la partie |
| **Test solo** (admin) | Partie solo immédiate avec bots pour tester |

Les salons privés acceptent jusqu'à 2 bots ajoutés à la création ou en salon d'attente (+ Bot).

## Commandes en jeu

| Touche | Action |
|---|---|
| WASD / ZQSD | Se déplacer |
| Espace | Sauter |
| Shift | Sprint |
| Souris | Caméra |
| Q ou clic gauche | Attaquer |
| E | Interagir (coffres, ressources) |
| T | Poser un piège |
| C | Menu d'artisanat (fabriquer épée, arc, hache de guerre) |
| G / F | Emotes |
| Tab | Classement de la partie |

## Mécanique du SWAP

Toutes les 25 à 45 secondes, l'serveur effectue un **échange global des corps** : chaque joueur se retrouve dans le corps d'un autre (arrangement sans point fixe). Les points de vie, les armes et la position restent attachés **au corps**, pas au joueur. L'objectif reste le même : être le dernier corps debout.

## Architecture technique

- **Front** : Three.js r128, HTML/CSS/JS vanilla (`index.html` menu, `game.html` jeu, `admin.html` panneau admin)
- **Back** : Node.js + Express + Socket.IO (`server.js`) — logique de jeu autoritaire côté serveur (dégâts, swaps, coffres, pièges, bots)
- **Persistance** : JSON simple avec sauvegarde différée (`data/db.json`)
- **Comptes** : mots de passe hachés (scrypt), sessions par token signé (30 jours)
- **Fonds d'écran** : déposes des images dans `assets/backgrounds/` (voir `README.md` du dossier) pour remplacer les dégradés

## Configuration serveur (admin)

Depuis `/admin.html` : durée min/max du swap, dégâts des armes, nombre de coffres/ressources, annonces globales, bannir/muter des joueurs, ajuster niveaux et Cristaux.

## Dépannage

- **"Non authentifié — recharge la page"** en jeu : ta session socket s'est coupée (mise en veille de l'onglet, coupure réseau). Recharge la page, la partie est conservée quelques minutes.
- **Port 3000 occupé** : change `const PORT` en haut de `server.js`.
