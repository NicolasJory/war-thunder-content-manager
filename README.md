# War Thunder Content Manager

Parcourir les camouflages publiés sur [War Thunder Live](https://live.warthunder.com) et les installer dans le jeu en un clic, sans toucher au moindre fichier.

Sans l'application, poser un camouflage veut dire télécharger une archive, la dézipper et déposer le dossier au bon endroit dans les fichiers du jeu. L'application fait ces trois étapes pour vous, et sait défaire proprement ce qu'elle a posé.

## Fonctionnalités

- Catalogue en défilement infini, filtres par pays, type, classe et véhicule
- Recherche par hashtag, tri sur les quatre critères du site
- Fiche détaillée avec galerie zoomable, statistiques et description
- Installation en un clic, avec choix du nom de dossier affiché en jeu
- Suivi de ce qui est installé, détection des contenus republiés depuis
- Favoris d'auteurs, partage de liens, ouverture d'un lien reçu directement dans l'application
- Interface en anglais, français, russe et chinois simplifié

L'application détecte votre installation Steam au premier lancement. Elle ne touche jamais aux dossiers qu'elle n'a pas créés : les templates livrés par Gaijin et les camouflages posés à la main restent intacts, et sont affichés en lecture seule.

## Installation

Aucune version publiée pour le moment. En attendant, voir [Développement](#développement).

### Avertissements à la première ouverture

Les binaires ne sont pas signés — un certificat coûte plusieurs centaines d'euros par an, ce qui n'a pas de sens pour un outil gratuit. Deux conséquences.

**Windows affiche « Windows a protégé votre ordinateur ».** Cliquez sur « Informations complémentaires », puis « Exécuter quand même ».

**Votre antivirus peut réagir.** Une application Electron non signée qui écrit dans un dossier de jeu et fait des requêtes réseau coche plusieurs cases d'un profil suspect. Le code est intégralement lisible dans ce dépôt, et vous pouvez le construire vous-même si vous préférez.

## Ce que l'application fait de vos données

Rien ne sort de votre machine. Il n'y a ni compte, ni télémétrie, ni serveur intermédiaire : l'application interroge War Thunder Live directement, et écrit uniquement dans le dossier `UserSkins` de votre jeu.

Le contenu installé est visible de vous seul, en local. Le serveur de jeu ne le voit pas.

Les réglages tiennent dans un fichier, à côté du dossier de configuration de l'application :

```
%APPDATA%\War Thunder Content Manager\config.json
```

## Développement

Il vous faut Node.js 20 ou plus récent.

```bash
npm install
npm run dev
```

### Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | Lance l'application avec rechargement à chaud |
| `npm run build` | Vérifie les types et construit les trois processus |
| `npm run typecheck` | Vérifie les types seuls |
| `npm run smoke` | Installation réelle : télécharge deux vraies archives et les pose dans un dossier de test |
| `npm run smoke:real` | Idem, mais dans votre vrai dossier de jeu — vérifie qu'il ressort intact |
| `npm run smoke:ui` | Filtres, traductions, découpage des descriptions |
| `npm run smoke:validate` | Validation de la frontière IPC, liens entrants, manifeste |
| `npm run smoke:config` | Détection Steam, persistance |

Les tests touchent la vraie API et de vraies archives. Ils sont lents et dépendent du réseau, c'est voulu : une suite qui ne parle qu'à des simulacres ne remarquerait pas que l'API a changé.

### Structure

```
src/
  main/       Processus Electron : appels réseau, installation, filesystem
  preload/    Pont contextBridge, seule surface exposée au renderer
  renderer/   Interface React
  shared/     Modules purs partagés par les deux côtés
```

Le renderer n'a accès ni au réseau, ni au système de fichiers. Tout passe par des canaux IPC nommés, dont les arguments sont validés à l'arrivée.

### Quand l'API de Live change

Les endpoints ne sont pas officiels. Ils sont tous déclarés dans `src/shared/endpoints.ts` — adresses, en-têtes, motif d'extraction des filtres, hôtes autorisés, limites de sécurité — et aucune URL n'est écrite en dur ailleurs.

Vous pouvez remplacer tout ou partie du manifeste sans recompiler, en déposant un fichier à côté de la configuration :

```
%APPDATA%\War Thunder Content Manager\endpoints.json
```

```json
{
  "api": { "feed": "/api/v2/feed/" },
  "downloadHosts": ["cdn2.warthunder.com"]
}
```

Chaque champ est validé séparément. Un fichier à moitié faux garde les valeurs par défaut pour ce qui ne passe pas, plutôt que de casser l'application.

## Limites connues

**Un lien `https://live.warthunder.com` reçu sur Discord ouvrira votre navigateur.** Windows réserve l'interception des liens web au navigateur par défaut. Deux contournements : les liens partagés depuis l'application utilisent un protocole maison qui l'ouvre directement, et coller une URL Live dans le champ de recherche ouvre le contenu dans l'application.

**Les libellés des filtres véhicule restent en anglais** dans toutes les langues. Ils viennent de l'API, sur une taxonomie de plus de 3 000 entrées qui bouge à chaque mise à jour du jeu.

**Les viseurs et les mods son ne sont pas encore installables.** L'architecture les accueille, le travail reste à faire.

## Licence

[GPL-3.0](LICENSE).

Les polices Inter sont distribuées sous [SIL Open Font License 1.1](https://github.com/rsms/inter/blob/master/LICENSE.txt).

La police d'icônes qui dessine les insignes nationaux appartient à Gaijin Entertainment. Elle n'est pas redistribuée : l'application la télécharge depuis leur serveur au premier lancement, comme le ferait un navigateur.

Ce projet n'est ni affilié à Gaijin Entertainment, ni approuvé par eux. War Thunder et War Thunder Live sont leurs marques.
