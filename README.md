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

Une connexion Internet est nécessaire (pour charger les bibliothèques d'affichage et parler à Supabase).

Pour arrêter le serveur, retournez dans le Terminal et faites Ctrl+C.

## Comment vos notes sont sauvegardées

Vos notes sont enregistrées dans une base de données **Supabase** (et non plus dans le navigateur). Chaque ajout, modification ou suppression est envoyé immédiatement à Supabase ; l'indicateur en haut à droite du site confirme l'enregistrement.

Le site est **privé** : personne ne peut consulter ni modifier vos fiches sans se connecter avec votre compte. La connexion se fait une seule fois par appareil (email + mot de passe) — ensuite, votre navigateur reste connecté indéfiniment, jusqu'à ce que vous cliquiez sur « Se déconnecter ».

Le bouton « Exporter le JSON » reste disponible pour garder une copie locale de sauvegarde (fichier `syntopicon.json` téléchargé sur votre ordinateur, pas versionné dans le dépôt) ; « Importer » permet de restaurer entièrement vos données depuis un tel fichier (cela remplace le contenu actuel de la base).

## Configurer Supabase (à faire une seule fois)

1. **Créer les tables.** Dans le Dashboard Supabase de votre projet, ouvrez SQL Editor > New query, collez le contenu de [`supabase/schema.sql`](supabase/schema.sql) et cliquez sur Run. Cela crée les tables `themes`, `entries`, `imported_batches` et les règles de sécurité (RLS) qui réservent chaque ligne à son propriétaire.
2. **Créer votre compte (le seul autorisé).** Toujours dans le Dashboard : Authentication > Users > Add user, renseignez votre email et un mot de passe. C'est ce couple email/mot de passe que vous utiliserez pour vous connecter au site.
3. **Fermer les inscriptions publiques.** Authentication > Sign In / Providers > Email, puis désactivez « Allow new users to sign up » (ou l'équivalent selon la version du Dashboard). Ainsi, même si quelqu'un tombait sur votre site, personne d'autre ne peut créer de compte.
4. **Récupérer vos clés.** Settings > API : copiez « Project URL » et la clé « anon public » (surtout pas la clé « service_role », qui elle est secrète).
5. **Renseigner `supabase-config.js`** à la racine du projet avec ces deux valeurs (voir les commentaires dans le fichier). Cette clé "anon" est prévue pour être publique : la vraie protection vient des règles RLS créées à l'étape 1, pas du secret de cette clé.
6. Lancez le site (voir ci-dessus) et connectez-vous avec le compte créé à l'étape 2. Au tout premier login, vos thèmes et fiches de départ sont automatiquement créés dans Supabase.

## Mettre le site en ligne (GitHub Pages)

1. Envoyez les fichiers du projet sur votre dépôt GitHub (branche `main`, `site` ou `gh-pages`), y compris `supabase-config.js` une fois rempli.
2. Dans le dépôt, allez dans Settings puis Pages.
3. Sous « Build and deployment », choisissez « Deploy from a branch », sélectionnez votre branche et le dossier racine, puis enregistrez.
4. Le site sera disponible après quelques instants à l'adresse `https://VOTRE-UTILISATEUR.github.io/VOTRE-DEPOT/`.

**Confidentialité** : même si le dépôt GitHub est public (nécessaire pour GitHub Pages gratuit), vos notes ne le sont pas. Le code source de la page est public (comme pour tout site statique), mais les données elles-mêmes vivent dans Supabase et ne sont accessibles qu'après connexion avec le compte créé plus haut, grâce aux règles de sécurité (RLS) définies dans `supabase/schema.sql`.
