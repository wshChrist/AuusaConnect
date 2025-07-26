# Plugin Matchmaking Rocket League

Ce dossier contient un squelette de plugin Bakkesmod.

## Compilation

1. Installer [Bakkesmod SDK](https://github.com/bakkesmodorg/BakkesModSDK) et suivez les instructions pour configurer Visual Studio.
2. Copier les fichiers de ce dossier dans un projet de plugin Bakkesmod.
3. Ajouter la dépendance à la bibliothèque [cpr](https://github.com/libcpr/cpr) pour effectuer des requêtes HTTP.
4. Compiler en Release et placer le `.dll` généré dans le dossier `bakkesmod/plugins`.

## Fonctionnement

Le plugin récupère les informations de fin de match et les envoie au bot Discord via une requête HTTP POST.
Il transmet notamment :

- le score global des équipes ;
- la liste des joueurs ayant marqué ;
- le nom du MVP ;
- pour chaque joueur, son nombre de buts, d'arrêts et son score.
