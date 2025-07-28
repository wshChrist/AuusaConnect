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
`/setchannel`. Utilisez-la dans le salon souhaité pour que les scores y soient
publiés. Ce choix est désormais mémorisé dans un fichier `channel.json`,
permettant de conserver le même salon même après un redémarrage du bot.

Le bot reçoit désormais des informations détaillées sur la partie (buteurs, passes décisives, tirs cadrés, MVP, scores individuels, arrêts et vrais noms d'équipe) et les présente sous forme de message formaté dans le salon configuré.
