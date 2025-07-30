# Bot Discord Matchmaking

Ce dossier contient un bot Discord minimal en Node.js.
Il expose un endpoint HTTP pour recevoir les données du plugin et les affiche dans un salon Discord.

## Prérequis

- Node.js >= 18
- Un token de bot Discord

## Installation

```bash
npm install
```

## Lancement

Le bot lit automatiquement les variables définies dans un fichier `.env` à la racine du dossier.

```bash
node index.js
```

Au premier lancement, le bot enregistre automatiquement la commande slash
`/setup`. Celle-ci comporte plusieurs sous-commandes :

- `/setup channel` — enregistre le salon actuel pour publier les scores de
  match. Le choix est stocké dans `channel.json` afin d'être conservé au
  redémarrage du bot.
- `/setup verification` — installe la vérification dans le salon courant en
  créant les rôles **Membre** et **Non vérifié** si nécessaire. Cette commande
  accepte en option un rôle déjà présent sur le serveur, qui sera attribué aux
  membres une fois vérifiés. Le message de vérification est posté et ses
  informations sont mémorisées dans `verify.json`.

Pour installer la vérification, utilisez la sous‑commande `/setup verification`.
Cette action crée les rôles **Membre** et **Non vérifié** si besoin, puis cherche s'il existe déjà un message avec une réaction dans ce salon. Si c'est le cas, le message le plus récent est utilisé comme support de vérification et la réaction ✅ y est ajoutée. Sinon, le bot poste un nouveau message de vérification. Les informations sont ensuite enregistrées dans `verify.json`.
Vous pouvez préciser un rôle existant avec l'option `role` pour qu'il soit attribué après validation, par exemple : `/setup verification role:@Membres`.

Une fois la vérification active, tout nouveau membre se voit attribuer automatiquement le rôle **Non vérifié**. Il devra cliquer sur la réaction pour recevoir le rôle de membre classique.

Le bot reçoit désormais des informations détaillées sur la partie (buteurs, passes décisives, tirs cadrés, MVP, scores individuels, arrêts et vrais noms d'équipe) et les présente sous forme de message formaté dans le salon configuré.
