# Plugin AuusaConnect

Ce dossier contient le plugin Bakkesmod AuusaConnect.

## Compilation

1. Installer [Bakkesmod SDK](https://github.com/bakkesmodorg/BakkesModSDK) et suivez les instructions pour configurer Visual Studio.
2. Copier les fichiers de ce dossier dans un projet de plugin Bakkesmod.
3. Ajouter la dépendance à la bibliothèque [cpr](https://github.com/libcpr/cpr) pour effectuer des requêtes HTTP.
4. Compiler en Release et placer le `.dll` généré dans le dossier `bakkesmod/plugins`.

## Configuration

Créer un fichier `config.json` placé dans le dossier de données du plugin (un exemple est fourni dans ce dépôt).
Il doit contenir les champs suivants :

```json
{
  "SUPABASE_URL": "https://TON_PROJECT.supabase.co/rest/v1/match_sessions",
  "SUPABASE_API_KEY": "TON_API_KEY",
  "SUPABASE_JWT": "TON_JWT",
  "BOT_ENDPOINT": "http://localhost:3000/match"
}
```

Lors du chargement, le plugin lit ce fichier et utilise les valeurs pour contacter Supabase
et déterminer l'URL d'envoi des résultats au bot Discord.

Le cvar `mm_player_id` est automatiquement défini sur le pseudo en jeu du joueur.


## Debug

Le plugin expose le cvar `mm_debug` (0 ou 1). Lorsqu'il est activé, chaque \
événement détecté (dégagement, duel remporté, ramassage de boost, etc.) est \
affiché dans la console BakkesMod avec le nom du joueur et le temps de jeu.

## Fonctionnement

Le plugin récupère les sessions de match depuis la table `match_sessions` de Supabase
(`player_id`, `rl_name`, `rl_password`), puis envoie les informations de fin de match au bot
Discord via une requête HTTP POST vers l'URL définie par `BOT_ENDPOINT`
(par défaut `http://localhost:3000/match`).
Il transmet notamment :

- le score global des équipes ;
- la liste des joueurs ayant marqué ;
- le nom du MVP ;
- pour chaque joueur, son nombre de buts, de passes décisives, de tirs cadrés, d'arrêts et son score.
- les noms exacts des équipes telles qu'affichées en jeu.
 - pour chaque joueur, des statistiques de boost et un indicateur de qualité de rotation (compris entre 0 et 1) évalué à partir de sa position dans la rotation (1er/2ᵉ/3ᵉ homme) tout au long du match.
- des statistiques défensives détaillées (arrêts, dégagements, challenges gagnés, démolitions, temps passé en défense, sauvetages critiques et blocks).

## Statistiques défensives

Les métriques ci-dessous permettent d'analyser plus finement l'impact défensif des joueurs. Chaque statistique est extraite via le SDK Bakkesmod et envoyée en fin de partie dans la requête HTTP.

| Statistique | Méthode de détection | Moment de capture | Conditions spécifiques | Format |
|-------------|---------------------|------------------|-----------------------|-------|
| **Arrêts** | `GetSaves()` ou interception d'un tir cadré bloqué | En direct pour incrémentation, résumée en fin de match | Tir cadré stoppé dans la moitié défensive | entier |
| **Dégagements** | Position de la balle frappée depuis sa moitié vers l'adversaire | En direct | Distance parcourue supérieure à un seuil et balle éloignée de la zone dangereuse | entier |
| **Challenges gagnés** | Événement de contact (`CarWrapper` et `BallWrapper`) dans sa moitié | En direct | Duel remporté (50/50) en zone défensive | entier |
| **Démolitions défensives** | `OnDemolition()` filtré par position du joueur défenseur | En direct | L'adversaire est démoli dans la moitié défensive du joueur | entier |
| **Démolitions offensives** | `OnDemolition()` filtré par position du joueur attaquant | En direct | L'adversaire est démoli dans sa propre moitié de terrain | entier |
| **Temps en défense** | Suivi continu de `CarWrapper.GetLocation()` < ligne médiane | Continu puis somme à la fin | Joueur présent dans sa moitié de terrain | secondes ou pourcentage du temps de jeu |
| **Sauvetages critiques** | Vérification du nombre de coéquipiers derrière le ballon lors d'un arrêt | En direct | Dernier défenseur entre l'attaquant et le but et tir cadré | entier |
| **Blocks** | Contact balle adverse + redirection de trajectoire | En direct | Blocage d'un tir ou d'une passe dangereuse | entier |
