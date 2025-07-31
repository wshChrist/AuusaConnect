# AuusaConnect

Ce dépôt contient un exemple minimal permettant de relier Rocket League (via un plugin Bakkesmod) à un bot Discord pour un système de matchmaking.

## Contenu

 - `plugin/` : squelette du plugin Bakkesmod. Il envoie au bot Discord les scores de fin de match, les statistiques individuelles (buteurs, passes décisives, tirs cadrés, arrêts, MVP, etc.) ainsi qu'un indicateur complet de qualité de rotation (score entre 0 et 1) calculé à partir de la position 1er/2ᵉ/3ᵉ homme tout au long du match. Le plugin fournit également des statistiques défensives détaillées pour mesurer l'impact de chaque joueur.
- `bot/` : petit serveur Node.js utilisant Discord.js et Express pour recevoir les données du plugin et les publier dans un salon.

Chaque dossier possède un `README.md` détaillant la mise en place.

## Base de données Supabase

Les tables suivantes doivent être créées dans votre projet Supabase :

### `teams`

| Colonne       | Type      | Clé étrangère            |
|--------------|-----------|--------------------------|
| `id`         | `uuid`    | clé primaire             |
| `name`       | `text`    |                          |
| `description`| `text`    |                          |
| `captain_id` | `uuid`    | référence `auth.users.id`|
| `coach_id`   | `uuid`    | référence `auth.users.id`|
| `manager_id` | `uuid`    | référence `auth.users.id`|
| `elo`        | `integer` |                          |
| `logo`       | `text`    |                          |

### `team_members`

| Colonne  | Type   | Clé étrangère           |
|----------|--------|-------------------------|
| `id`     | `uuid` | clé primaire            |
| `team_id`| `uuid` | référence `teams.id`    |
| `user_id`| `uuid` | référence `auth.users.id`|

### `team_invitations`

| Colonne  | Type   | Clé étrangère           |
|----------|--------|-------------------------|
| `id`     | `uuid` | clé primaire            |
| `team_id`| `uuid` | référence `teams.id`    |
| `user_id`| `uuid` | référence `auth.users.id`|
| `status` | `text` |                         |
| `role`   | `text` |                         |

### `match_history`

| Colonne  | Type       | Clé étrangère       |
|----------|------------|--------------------|
| `id`     | `uuid`     | clé primaire       |
| `team_a` | `uuid`     | référence `teams.id`|
| `team_b` | `uuid`     | référence `teams.id`|
| `score`  | `text`     |                    |
| `date`   | `timestamp`|                    |
| `winner` | `uuid`     | référence `teams.id`|
