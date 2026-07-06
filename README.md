# Syntopicon

Espace de travail personnel pour classer des idées de lecture par thème, sous forme de tableau (vue Kanban). Site entièrement statique, prévu pour un hébergement sur GitHub Pages, sans serveur ni base de données.

## Contenu du dossier

- `index.html` : la page qui charge et affiche l'application.
- `app.jsx` : le code de l'application (c'est ici que vous ferez évoluer l'outil).
- `syntopicon.json` : le corpus de départ (thèmes et premières fiches). Sert de point de départ au premier chargement et de version publiée de vos notes.
- `.nojekyll` : fichier vide qui désactive le traitement Jekyll de GitHub Pages.
- `README.md` : ce fichier.

## Comment fonctionne la sauvegarde des champs de texte

La sauvegarde repose sur trois niveaux, du plus automatique au plus durable.

1. Enregistrement automatique dans le navigateur. Chaque saisie (titre, thème, source, annotations, capture rapide) est écrite en continu dans le stockage local du navigateur (localStorage). Fermer l'onglet ou le navigateur ne perd rien : en rouvrant le site sur le même appareil et le même navigateur, tout est retrouvé. Cela fonctionne sur un hébergement statique, sans serveur et sans jeton d'accès.

2. Export en fichier JSON. Le bouton « Exporter le JSON » télécharge l'intégralité du corpus dans un fichier `syntopicon.json` lisible. C'est votre sauvegarde réelle : transportable, inspectable, et versionnable dans Git. Le bouton « Importer » recharge un tel fichier, pour restaurer une sauvegarde ou passer d'un appareil à un autre.

3. Version publiée dans le dépôt. Au tout premier chargement, si le stockage local est vide, l'application lit le `syntopicon.json` présent dans le dépôt et l'utilise comme corpus de départ. Pour publier un nouvel état, exportez le JSON puis remplacez `syntopicon.json` dans le dépôt et validez le commit.

Ordre de priorité : le stockage local de votre navigateur l'emporte sur le fichier publié. Autrement dit, sur un appareil où vous avez déjà travaillé, vos saisies locales priment ; pour récupérer une version mise à jour ailleurs, utilisez « Importer » avec le fichier concerné.

Réserve importante : le stockage local n'est pas un fichier et peut être effacé si vous videz les données du navigateur. Traitez donc l'export JSON, puis son commit dans Git, comme votre véritable sauvegarde, et non le seul stockage local. Un commit régulier vous donne en outre un historique daté et réversible de la constitution de vos notes, particulièrement précieux sur la durée d'une thèse.

## Déploiement sur GitHub Pages

1. Envoyez ces fichiers sur une branche de votre dépôt (par exemple `site` ou `gh-pages`), à la racine de la branche.
2. Dans le dépôt, ouvrez Settings, puis Pages.
3. Sous « Build and deployment », choisissez la source « Deploy from a branch », sélectionnez votre branche et le dossier racine `/ (root)`, puis enregistrez.
4. Après quelques instants, le site est disponible à l'adresse `https://VOTRE-UTILISATEUR.github.io/VOTRE-DEPOT/`.

Rappel de confidentialité : sur un compte personnel gratuit, GitHub Pages n'est disponible que pour des dépôts publics. Tout ce qui est versé dans le dépôt, y compris `syntopicon.json`, est alors lisible publiquement. Si vos notes ne doivent pas être publiques, ne les versez pas dans un dépôt public, ou utilisez un dépôt privé (offre payante).

## Prévisualisation en local (facultatif)

Ouvrir `index.html` par un double-clic ne suffit pas : les navigateurs empêchent le chargement du fichier `app.jsx` depuis une adresse `file://`. Il faut servir le dossier localement, par exemple avec Python : depuis le dossier, lancez `python3 -m http.server 8000`, puis ouvrez `http://localhost:8000`.

## Fonctionnement entièrement hors ligne (facultatif)

Au chargement, `index.html` récupère trois bibliothèques (React, ReactDOM, Babel) depuis un CDN, ce qui requiert une connexion à ce moment. Vos données restent toujours locales. Pour supprimer toute dépendance à Internet, téléchargez une fois ces trois fichiers, placez-les dans un sous-dossier `vendor`, puis remplacez dans `index.html` les adresses `https://unpkg.com/...` par les chemins locaux correspondants :

- https://unpkg.com/react@18.3.1/umd/react.production.min.js
- https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js
- https://unpkg.com/@babel/standalone@7/babel.min.js
