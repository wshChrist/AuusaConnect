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

```bash
DISCORD_TOKEN=VOTRE_TOKEN node index.js
```

Au premier lancement, le bot enregistre automatiquement la commande slash
`/setchannel`. Utilisez-la dans le salon souhaité pour que les scores y soient
publiés.

Le bot reçoit désormais des informations détaillées sur la partie (buteurs, MVP, scores individuels, utilisation du boost) et les présente sous forme de message formaté dans le salon configuré. Pour chaque joueur sont indiquées la fréquence de prise de boost, la proportion de petits pads ramassés et le nombre de boosts gaspillés.
