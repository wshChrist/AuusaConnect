# AuusaConnect

Ce dépôt contient un exemple minimal permettant de relier Rocket League (via un plugin Bakkesmod) à un bot Discord pour un système de matchmaking.

## Contenu

 - `plugin/` : squelette du plugin Bakkesmod. Il envoie au bot Discord les scores de fin de match ainsi que des statistiques détaillées (buteurs, MVP, utilisation du boost...).
- `bot/` : petit serveur Node.js utilisant Discord.js et Express pour recevoir les données du plugin et les publier dans un salon.

Chaque dossier possède un `README.md` détaillant la mise en place.
