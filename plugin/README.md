# Plugin Matchmaking Rocket League

Ce dossier contient un squelette de plugin Bakkesmod.

## Compilation

1. Installer [Bakkesmod SDK](https://github.com/bakkesmodorg/BakkesModSDK) et suivez les instructions pour configurer Visual Studio.
2. Copier les fichiers de ce dossier dans un projet de plugin Bakkesmod.
3. Ajouter la dépendance à la bibliothèque [cpr](https://github.com/libcpr/cpr) pour effectuer des requêtes HTTP.
4. Compiler en Release et placer le `.dll` généré dans le dossier `bakkesmod/plugins`.

## Debug

Le plugin expose le cvar `mm_debug` (0 ou 1). Lorsqu'il est activé, chaque \
événement détecté (dégagement, duel remporté, ramassage de boost, etc.) est \
affiché dans la console BakkesMod avec le nom du joueur et le temps de jeu.

## Fonctionnement

Le plugin récupère les informations de fin de match et les envoie au bot Discord via une requête HTTP POST.
Il transmet notamment :

- le score global des équipes ;
- la liste des joueurs ayant marqué ;
- le nom du MVP ;
- pour chaque joueur, son nombre de buts, de passes décisives, de tirs cadrés, d'arrêts et son score.
- les noms exacts des équipes telles qu'affichées en jeu.
- pour chaque joueur, des statistiques de boost et un indicateur de qualité de rotation évalué à partir de sa position dans la rotation (1er/2ᵉ/3ᵉ homme) tout au long du match.
- des statistiques défensives détaillées (arrêts, dégagements, challenges gagnés, démolitions, temps passé en défense, sauvetages critiques et blocks).

## Statistiques défensives

Les métriques ci-dessous permettent d'analyser plus finement l'impact défensif des joueurs. Chaque statistique est extraite via le SDK Bakkesmod et envoyée en fin de partie dans la requête HTTP.

| Statistique | Méthode de détection | Moment de capture | Conditions spécifiques | Format |
|-------------|---------------------|------------------|-----------------------|-------|
| **Arrêts** | `GetSaves()` ou interception d'un tir cadré bloqué | En direct pour incrémentation, résumée en fin de match | Tir cadré stoppé dans la moitié défensive | entier |
| **Dégagements** | Position de la balle frappée depuis sa moitié vers l'adversaire | En direct | Distance parcourue supérieure à un seuil et balle éloignée de la zone dangereuse | entier |
| **Challenges gagnés** | Événement de contact (`CarWrapper` et `BallWrapper`) dans sa moitié | En direct | Duel remporté (50/50) en zone défensive | entier |
| **Démolitions défensives** | `OnDemolition()` filtré par position du joueur | En direct | L'adversaire est détruit près de son propre but | entier |
| **Temps en défense** | Suivi continu de `CarWrapper.GetLocation()` < ligne médiane | Continu puis somme à la fin | Joueur présent dans sa moitié de terrain | secondes ou pourcentage du temps de jeu |
| **Sauvetages critiques** | Vérification du nombre de coéquipiers derrière le ballon lors d'un arrêt | En direct | Dernier défenseur entre l'attaquant et le but et tir cadré | entier |
| **Blocks** | Contact balle adverse + redirection de trajectoire | En direct | Blocage d'un tir ou d'une passe dangereuse | entier |
