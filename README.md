# AuusaConnect

Ce dépôt contient un exemple minimal permettant de relier Rocket League (via un plugin Bakkesmod) à un bot Discord pour un système de matchmaking.

## Contenu

 - `plugin/` : code source du plugin Bakkesmod AuusaConnect. Il envoie au bot Discord les scores de fin de match, les statistiques individuelles (buteurs, passes décisives, tirs cadrés, arrêts, MVP, etc.) ainsi qu'un indicateur complet de qualité de rotation (score entre 0 et 1) calculé à partir de la position 1er/2ᵉ/3ᵉ homme tout au long du match. Le plugin fournit également des statistiques défensives détaillées pour mesurer l'impact de chaque joueur.
- `bot/` : petit serveur Node.js utilisant Discord.js et Express pour recevoir les données du plugin et les publier dans un salon.

Chaque dossier possède un `README.md` détaillant la mise en place.

## Configuration sécurisée

Le plugin lit les secrets (`BOT_ENDPOINT`, `API_SECRET`) depuis des variables d'environnement
ou un fichier local `config.json` (ignoré par Git). Un modèle `config.example.json` est
disponible dans `plugin/`. Copiez-le puis renseignez vos valeurs ou exportez les variables
correspondantes.

Pour le développement local, générez un certificat auto-signé puis lancez le bot en HTTPS :

```bash
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 365
SSL_KEY_PATH=./key.pem SSL_CERT_PATH=./cert.pem node bot/index.js
```

Dans ce cas, configurez le plugin avec `BOT_ENDPOINT=https://localhost:3000/match`.
En production, utilisez un certificat Let's Encrypt ou un reverse proxy (Nginx, Caddy)
et adaptez `BOT_ENDPOINT` vers l'URL publique, par exemple
`https://api.exemple.fr/match`.

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

Chaque utilisateur ne peut appartenir qu'à une seule équipe. Une contrainte d'unicité sur `user_id` est donc recommandée pour éviter les doublons dans `team_members`.

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

## Matchmaking vocal avancé

Les vocaux publics servant de point de départ au matchmaking doivent respecter la forme `🎮│XvX` (ex. `🎮│1v1`, `🎮│2v2`). Le bot calcule automatiquement le nombre de joueurs attendus à partir de ce nom pour créer les salons privés et enregistrer la session dans Supabase.
