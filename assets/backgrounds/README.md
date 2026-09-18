# Fonds d'écran des interfaces

Ce dossier est vide par défaut : chaque interface utilise un dégradé généré
en CSS en attendant une vraie image. Pour activer une image, dépose-la ici
avec **exactement** le nom de fichier indiqué ci-dessous (aucune modification
de code nécessaire — le site la détecte automatiquement au prochain
rechargement de page).

| Fichier attendu | Interface | Ambiance visée |
|---|---|---|
| `play.jpg` | Onglet Jouer | Arène de survie, ciel dramatique, jungle/arctique/désert mélangés |
| `shop.jpg` | Boutique | Vitrine violette/dorée, néons, ambiance "loot" |
| `battlepass.jpg` | Pass de combat | Bannière de saison sombre, accents jaune/violet façon course arcade |
| `profile.jpg` | Profil | Fond bleu/cyan, feuille de personnage, grille technologique |
| `friends.jpg` | Amis | Ambiance sociale, vert/turquoise |
| `leaderboard.jpg` | Classement | Podium doré, confettis, ambiance victoire |
| `settings.jpg` | Réglages | Sobre, gris/bleu nuit |

## Format recommandé

- **Format** : JPG ou PNG, paysage, au moins 1600×900px (l'image est étirée
  en `cover`, donc plus c'est grand, plus c'est net sur les grands écrans).
- **Sombre de préférence** : le texte par-dessus est clair, une image trop
  claire au centre rendra la lecture difficile.

## Suggestions de prompts (si tu utilises Gemini ou un autre générateur)

Style général à répéter dans chaque prompt pour garder une identité
cohérente : *"pixel art, style Minecraft/rétro-arcade, palette de couleurs
vives, sombre et contrasté, sans texte ni logo, format paysage 16:9"*.

- **play.jpg** : *"paysage pixel art d'une arène de survie mélangeant
  jungle, glacier et désert, ciel orageux, style Minecraft rétro-arcade"*
- **shop.jpg** : *"vitrine de boutique pixel art avec étagères de coffres et
  cosmétiques flottants, néons violets et dorés, style rétro-arcade"*
- **battlepass.jpg** : *"bannière de saison de battle pass pixel art,
  bandes diagonales jaunes et violettes, ambiance course futuriste sombre"*
- **profile.jpg** : *"fond technologique pixel art bleu cyan avec grille
  lumineuse, style feuille de personnage de jeu vidéo rétro"*
- **friends.jpg** : *"fond pixel art vert turquoise avec silhouettes de
  personnages en groupe, ambiance amicale rétro-arcade"*
- **leaderboard.jpg** : *"podium pixel art doré avec confettis et trophée,
  ambiance victoire, style rétro-arcade sombre"*
- **settings.jpg** : *"fond pixel art sobre gris-bleu nuit avec engrenages
  discrets, style rétro-arcade minimaliste"*

Tant qu'un fichier n'existe pas, l'interface garde son dégradé de secours —
rien ne « casse » visuellement si tu n'ajoutes que certaines images et pas
toutes.
