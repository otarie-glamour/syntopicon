# Syntopicon

Espace de travail personnel pour classer des idées de lecture par thème, sous forme de tableau (vue Kanban).

## Comment tester le site sur votre ordinateur

Vous n'avez pas besoin d'installer quoi que ce soit de spécial. Ouvrir directement le fichier `index.html` en double-cliquant ne fonctionne pas (le navigateur bloque ce mode de fonctionnement). Il faut passer par une petite commande :

1. Ouvrez le Terminal (application déjà présente sur Mac).
2. Placez-vous dans le dossier du projet, par exemple :
   ```
   cd /Users/anto/Documents/syntopicon
   ```
3. Lancez cette commande (Python est déjà installé sur votre Mac) :
   ```
   python3 -m http.server 8000
   ```
4. Ouvrez votre navigateur à l'adresse `http://localhost:8000`.

Une connexion Internet est nécessaire à l'ouverture de la page (pour charger les bibliothèques d'affichage), mais vos données restent toujours sur votre ordinateur.

Pour arrêter le serveur, retournez dans le Terminal et faites Ctrl+C.

## Comment vos notes sont sauvegardées

1. **Automatique dans le navigateur.** Tout ce que vous tapez (titres, thèmes, sources, annotations) est enregistré en continu dans votre navigateur. Fermer l'onglet ne perd rien : en rouvrant le site sur le même ordinateur et le même navigateur, tout est retrouvé.

2. **Export en fichier JSON.** Le bouton « Exporter le JSON » télécharge l'intégralité de vos notes dans un fichier `syntopicon.json`. **C'est votre vraie sauvegarde** : le stockage automatique du navigateur peut être effacé (nettoyage du navigateur, changement d'ordinateur, etc.), alors que ce fichier, une fois téléchargé, est en sécurité. Pensez à l'exporter régulièrement. Le bouton « Importer » permet de recharger un tel fichier.

3. **Version publiée sur le dépôt en ligne (GitHub).** Si vous mettez à jour le fichier `syntopicon.json` dans votre dépôt GitHub, cette version sert de point de départ la première fois que vous ouvrez le site sur un nouvel appareil (quand le navigateur n'a encore rien en mémoire).

En résumé : le navigateur retient tout automatiquement au jour le jour, mais la sécurité réelle vient des exports JSON réguliers.

## Mettre le site en ligne (GitHub Pages)

1. Envoyez les fichiers du projet sur votre dépôt GitHub (branche `main`, `site` ou `gh-pages`).
2. Dans le dépôt, allez dans Settings puis Pages.
3. Sous « Build and deployment », choisissez « Deploy from a branch », sélectionnez votre branche et le dossier racine, puis enregistrez.
4. Le site sera disponible après quelques instants à l'adresse `https://VOTRE-UTILISATEUR.github.io/VOTRE-DEPOT/`.

**Attention à la confidentialité** : sur un compte GitHub gratuit, un site publié ainsi n'est possible que pour un dépôt public. Tout ce qui s'y trouve, y compris vos notes dans `syntopicon.json`, devient alors lisible par n'importe qui. Si vos notes doivent rester privées, ne les publiez pas sur un dépôt public (il existe des dépôts privés, mais réservés aux comptes payants).
