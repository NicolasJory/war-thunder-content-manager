# Mods son : conception

Statut : livré le 2026-09-10. Ce document décrit ce qui tourne.
Relevés : 20 archives ouvertes en requêtes Range sur Live.

## Ce que contiennent vraiment les archives

50 mods son publiés. Les archives pèsent de 7 à 853 Mo. Deux dépassent déjà
`maxDownloadBytes` (512 Mo).

Sur les 20 archives ouvertes :

| Forme | Nombre | Ce qu'on en fait |
|---|---|---|
| Plate | 10 | on copie tout dans `sound/mod/` |
| Un dossier racine | 5 | on retire le dossier, on copie tout |
| Dossiers additifs | 1 | l'utilisateur coche ce qu'il veut |
| Dossiers exclusifs | 3 | l'utilisateur en choisit un |
| Variantes préfixées | 1 | l'utilisateur en choisit une, et on la renomme |

16 archives sur 20 se posent sans poser de question.

**Les langues ne sont pas un choix.** Je m'étais trompé sur ce point. Un mod
d'équipage livre `_crew_dialogs_ground_en.bank`, `_crew_dialogs_ground_ru.bank`,
`_crew_dialogs_ground_de.bank` côte à côte, avec des noms de fichiers
différents. Le jeu prend celui qui correspond à la nationalité de l'équipage.
On les pose tous, il n'y a rien à demander. `GuP Crew Mod` en livre 26 d'un
coup, à plat.

**Le vrai choix porte sur des dossiers qui répètent les mêmes noms de
fichiers.** `Ooarai` propose `Tank Crew/Anglerfish`, `Tank Crew/Duck`,
`Tank Crew/Hippo` et six autres, chacun avec les 9 mêmes `.bank`. Ils
s'écrasent : il faut en retenir un. `IASM v17.5` fait pareil avec 22 dossiers
RWR contenant tous `aircraft_gui.bank`, et le dit dans le nom du dossier :
« Step 2 - Choose and install files from one RWR folder from here ».

**À côté, des dossiers qui cohabitent.** `Girls und Panzer` sépare
`Background music`, `Planes`, `Radio Chat`, `Ships` et `Tanks`. Aucun nom de
fichier en commun : on peut prendre les cinq, ou seulement `Tanks`.

Ces deux cas se distinguent en lisant l'index du zip, sans deviner : deux
dossiers qui partagent un nom de fichier sont des alternatives, deux dossiers
qui n'en partagent aucun s'additionnent.

**Un troisième cas n'est apparu qu'à l'installation réelle.** `Yuka_vws_2.0`
livre `English_aircraft_gui.bank`, `Chinese_aircraft_gui.bank` et
`Japanese_aircraft_gui.bank` à plat, sans dossier. Le jeu ne lit que
`aircraft_gui.bank` : posés tels quels, les trois ne font rien du tout, et
l'utilisateur n'a aucun moyen de comprendre pourquoi. Ce sont des alternatives,
comme les équipages d'Ooarai, mais séparées par un préfixe au lieu d'un dossier.

Le repère est le catalogue de banques du jeu, lu dans `<jeu>/sound` (275
fichiers). Un nom qui vaut `<préfixe>_` + une banque d'origine désigne une
variante de celle-ci. On exige deux préfixes distincts visant la même banque
avant de conclure : un fichier préfixé isolé est plus probablement une banque
que le mod ajoute pour son compte.

À ne pas confondre avec `_crew_dialogs_ground_ja.bank`, absent d'une
installation sans le japonais. Celui-là suit le nommage d'origine et se pose tel
quel — il ne se termine par `_` suivi d'aucune banque connue.

## Où ça se pose

Le jeu lit les banques modifiées dans `<gameDir>/sound/mod/`, à plat. Le
dossier n'existe pas tant que personne n'a installé de mod. À côté,
`<gameDir>/sound/` contient les 275 banques d'origine (2,8 Go) : on n'y touche
jamais.

Le jeu ignore `sound/mod/` tant que `config.blk` ne l'autorise pas. Le bloc
actuel, en CRLF :

```
sound{
  fmod_sound_enable:b=yes
  speakerMode:t="stereo"
}
```

Il faut y ajouter `enable_mod:b=yes`. Les auteurs donnent cette instruction
eux-mêmes dans leurs descriptions de post.

## Trois états, rien de fantôme

Décision prise le 10 septembre. Une désinstallation ne laisse rien derrière
elle.

| État | Sur le disque |
|---|---|
| Pas téléchargé | rien |
| Téléchargé, actif | le zip + les fichiers posés dans `sound/mod/` |
| Téléchargé, inactif | le zip seul |

| Verbe | Effet |
|---|---|
| Installer | télécharge le zip, ouvre l'écran de choix, pose les fichiers |
| Désactiver | retire les fichiers de `sound/mod/`, garde le zip |
| Activer | repose les fichiers, sans retélécharger |
| Désinstaller | efface les fichiers ET le zip |

Désinstaller un mod actif demande confirmation, en disant qu'il est en service.

L'onglet Installés montre les deux états téléchargés, l'actif et l'inactif.
Basculer entre deux mods possédés ne relance aucun téléchargement, ce qui
compte quand une archive fait 850 Mo.

Les zips vivent dans `app.getPath("userData")/library/sound/<lang_group>.zip`.
Le dossier du jeu est sur `D:`, la config sur `C:` : les stocker dans l'arbre
du jeu obligerait à gérer deux chemins possibles pour rien.

## Superposer plusieurs mods

Les auteurs comptent dessus. `IASM` nomme un de ses dossiers « skip if mixing
with RCSM » : il s'attend à ce qu'on l'active en même temps que RCSM, l'un pour
les avions, l'autre pour les chars. Les deux livrent `masterbank.bank`.

Règle : le dernier activé gagne le fichier. `meta.activatedAt` donne l'ordre.
Le mod recouvert reste actif pour tous ses autres fichiers.

L'avertissement arrive **avant** l'action, pas après. La boîte d'installation
compare les banques que la sélection va poser à celles déjà en service, et le
dit — avant de lancer 850 Mo de téléchargement. Décocher le groupe fautif fait
disparaître l'avertissement. Même chose sur le bouton d'activation d'un mod
déjà téléchargé.

Il regarde **deux sources**, et la seconde n'est pas un détail. Se fier aux
seuls enregistrements rendait l'avertissement aveugle à tout ce qui n'était pas
passé par l'application. Le cas est arrivé sur l'installation de test : OPEX
5.0.0 extrait à la main, seize banques dans `sound/mod`, aucun enregistrement
pour en parler. Installer RTCM par-dessus aurait remplacé trois de ses banques
en silence. `listForeignBanks` lit donc le dossier et retire ce que
l'application revendique ; le reste appartient à quelqu'un d'autre. On le
signale sans pouvoir le nommer, et on n'y touche jamais — même contrat que
`listForeign` pour les camouflages.

Deux formulations, parce que l'écart compte. Un mod qui perd quelques banques
continue de jouer le reste ; un mod qui les perd toutes est muet, et lui dire
« quelques sons remplacés » serait faux.

Au moment de désactiver ou de désinstaller, retirer les fichiers ne suffit
pas : si un mod en dessous fournissait `masterbank.bank`, le jeu se
retrouverait sans. On réextrait donc ce fichier depuis le zip du mod recouvert,
qui est encore là puisqu'il reste téléchargé. C'est ce que garder le zip permet
et qu'un téléchargement jeté après extraction ne permettrait pas.

## L'écran de choix

Une seule liste, construite depuis l'index du zip. Le zip n'est pas encore
téléchargé : deux requêtes Range sur son index suffisent, mesurées à ~200 ms
sur les archives réelles. Poser la question après dix minutes d'attente aurait
été une insulte.

Des cases à cocher partout, pas de boutons radio. Cocher un dossier décoche
ceux qui posent les mêmes fichiers : une famille d'alternatives se comporte donc
comme des radios sans que le code ait à distinguer les deux cas. La liste des
conflits vient du main, l'interface ne décide de rien.

```
Installer « Ooarai »

  [x] Radio Chat                 8 fichiers son

  Tank Crew
  Ces versions remplacent les mêmes fichiers son : une seule peut entrer.
  [x] Anglerfish                 9 fichiers son
  [ ] Anteater                   9 fichiers son
  [ ] Duck                       9 fichiers son
  …
```

Sélection de départ : tout ce qui s'additionne, plus le premier de chaque
famille d'alternatives. Sur `IASM v17.5` ça donne « Step 1 » et un seul dossier
RWR, ce que son auteur demande dans le nom même de ses dossiers.

Pour les 15 archives plates ou à dossier unique, l'écran ne s'affiche pas.

## Ce qui a changé dans le code existant

**`downloadZip` écrit sur disque.** Il accumulait les morceaux dans un tableau
puis appelait `Buffer.concat` : les deux vivaient en même temps, soit deux fois
la taille de l'archive. Le flux part maintenant sur disque et rien ne s'accumule.

Plafond mesuré, pas supposé : sur ETSMIV (853 Mo, la plus grosse du catalogue),
l'installation prend 10 s et culmine à 1,7 Go de RSS. `adm-zip` 0.6 fait un
`fs.readFileSync` même quand on lui passe un chemin, donc l'archive entière
repasse en mémoire, et `getData()` y ajoute la plus grosse entrée décompressée
(313 Mo). Le pic vaut « archive + plus grosse banque ». Descendre plus bas
demande un lecteur de zip qui lise vraiment à la demande (yauzl), ce qui touche
les trois installers : à faire si quelqu'un se plaint, pas avant.

Les trois garde-fous restent : hôte en liste blanche, plafond de taille, coupure
après une minute sans octet. Le plafond passe à 1 Go, sinon deux mods sur 50
restent inatteignables. Les camouflages et les viseurs y gagnent aussi : leur
archive passe par un fichier temporaire, effacé une fois extraite.

**`readZipIndex`** lit l'index d'une archive en deux requêtes Range, sans la
télécharger. Les redirections repassent par la même liste blanche que le
téléchargement. Un serveur qui répond 200 au lieu de 206 est traité comme un
refus : accepter serait recevoir l'archive entière, ce qu'on cherchait à éviter.

**`soundInstaller`** suit le modèle des viseurs plutôt que celui des
camouflages : `meta.files` liste chaque banque posée, `uninstall` ne retire que
les siennes, `path` pointe sur `sound/mod`. C'est ce qui rend la superposition
possible.

**Le patch de `config.blk`.** Pas de fichier `.bak`. Une sauvegarde posée à
l'installation et restaurée des semaines plus tard écraserait tout ce que le
joueur a réglé entre-temps. La ligne s'insère dans le bloc `sound{}` en gardant
les CRLF et l'indentation, et le record note qu'on l'a ajoutée. Au retrait du
dernier mod son, elle part si c'est nous qui l'avons mise. Si `enable_mod` était
déjà là, on n'y touche ni à l'aller ni au retour.

**`Installer.setActive`** est optionnel : seul le son l'implémente. Un
camouflage est installé ou ne l'est pas, il n'a pas d'état intermédiaire.

**Renderer.** L'entrée « Mods son » de la barre latérale est active. L'état et
la bascule (`SoundState`) vivent dans `shell.tsx` et servent deux vues :
Installés et la fiche détail. La boîte d'installation porte l'écran de choix et
l'avertissement de recouvrement, et une confirmation apparaît avant de
désinstaller un mod en service — elle propose la désactivation comme porte de
sortie.

**Corrigé au passage :** deux défauts que la fusion des onglets avait laissés
(commit `340f04f`). Le type d'installation se lisait sur l'onglet ouvert et non
sur le contenu, donc mettre à jour un viseur depuis Installés l'aurait posé
comme un camouflage. Et l'en-tête annonçait « n camouflages · … dans UserSkins »
pour tous les types confondus.

## Le mixeur : un emplacement, un mod

Ajouté le 12 septembre, à la demande.

Le modèle « un mod entier ou rien » ne sait pas exprimer une demande banale :
les voix françaises d'un mod et les allemandes d'un autre. Or le jeu lit
`sound/mod` à plat, un fichier par nom — chaque nom est donc une place, et le
panachage est la façon naturelle de raisonner dessus.

Sur les 20 archives relevées, **85 emplacements sur 105 sont disputés par au
moins deux mods**. `_crew_dialogs_ground_de` est fourni par 10 mods différents,
le français par 9. Le besoin n'est pas théorique.

### Les libellés se composent, ils ne s'écrivent pas

Le vocabulaire du jeu est régulier : `tanks_engines`, `aircraft_engines` et
`ships_engines` partagent leur seconde moitié, et `_crew_dialogs_ground_fr`
n'est que `crew_dialogs_ground` plus une langue. On traduit les morceaux.

Écrites en entier dans les quatre langues d'interface, les 4 familles × 31
langues × 21 emplacements fixes auraient fait plus de 400 chaînes. En morceaux,
il en reste une trentaine — et les noms de langue ne sont pas écrits du tout :
`Intl.DisplayNames` rend « allemand », « anglais américain », « japonais » dans
la langue de l'interface. Quatre codes du jeu ne sont pas normalisés (`jp`,
`sp`, `cz`, `nw`), ils ont leur table de correspondance ; un code inconnu
ressort en majuscules plutôt que déguisé en nom.

### Ce que le mixeur a révélé

Poser un mod par-dessus un autre ne retirait pas la revendication du premier.
Les deux annonçaient leurs fichiers, et les cartes affichaient 16 et 17 pour un
dossier qui n'en portait que 17. Le défaut passait inaperçu tant qu'un mod
était tout ou rien ; le mixeur, lui, a besoin de savoir à qui appartient chaque
place.

`reassignClaims` rend la revendication exclusive : `meta.files` répond
désormais à « qu'est-ce que ce mod occupe sur le disque », pas « qu'est-ce
qu'il a posé un jour ». Ce que le mod recouvert sait encore fournir n'est pas
perdu : `meta.provides` le dit, et `restoreCovered` s'appuie sur lui pour
rendre sa banque quand celui du dessus s'en va.

Deux handlers IPC rendent maintenant la liste entière au lieu du seul
enregistrement posé : recouvrir un mod change aussi le sien, et le renderer qui
refabriquait la liste depuis sa copie perdait ce changement.

### Où il vit

Son propre onglet, « Paramètres audio », sous l'entrée « Audio » de la barre
latérale. Il était d'abord une section de l'onglet Installés, ce qui le mettait
au mauvais endroit : Installés parle de contenu qu'on a récupéré, le mixeur dit
lequel joue. Trente lignes de réglages sous des cartes de mods n'appartenaient
pas à la même page.

L'interface dit « audio », plus « son » : le mot couvre aussi bien les voix
d'équipage que les moteurs, et il reste le même en anglais.

### Le masterbank

Signalé, jamais interdit. `masterbank` déclare les événements dont dépendent
les autres banques, et deux auteurs le disent : PCSM demande de supprimer « the
'masterbank' files that probably came from » un autre mod, IASM range ses
fichiers de base sous « skip if mixing with RCSM ». Sa ligne porte donc une
mise en garde au survol. Le joueur peut passer outre — c'est sa machine.

## Hors périmètre

Les archives qui remplacent les sons de menu ne passent pas par `sound/mod/`.
Elles se posent ailleurs et suivent une autre règle. On les refuse
explicitement plutôt que de les poser au mauvais endroit, où elles seraient
sans effet et invisibles.

## Vérification

`npm run smoke:sound` — 29 checks sur le module pur : classement des quatre
formes d'archive sur les entrées réelles de `RCSM`, `TC6p`, `Girls und Panzer`
et `Ooarai`, variantes préfixées de `Yuka`, le faux ami des langues, et le patch
de `config.blk` (CRLF, LF, bloc absent, accolades imbriquées, aller-retour à
l'octet près).

`npm run smoke:sound-install` — 10 checks sur le cycle complet, avec de vraies
archives et un dossier de jeu factice. Le check qui compte : deux mods livrent
`masterbank.bank`, le second recouvre le premier, et le désactiver **repose** la
banque du premier au lieu de laisser un trou. Sans ça, désactiver un mod
casserait celui du dessous en silence.

`npm run smoke:sound-slots` — 15 checks sur le mixeur : découpage des noms
(la paire `.bank`/`.assets.bank` fait un seul emplacement, `blu` n'est pas une
langue), revendication exclusive, et surtout le changement d'occupant — quand
le nouveau ne fournit que le `.assets.bank`, le `.bank` de l'ancien doit partir
quand même, sinon il resterait orphelin sur l'audio du nouveau.

`coveredBy` a ses propres checks : recouvrement partiel, total, casse
différente, mod inactif, réinstallation de soi-même, plusieurs mods touchés
d'un coup, et les banques posées hors de l'application — dont le cas qui
prouve la régression réparée, « sans la liste du disque : aveugle ».

Vérifié en plus dans l'application réelle, sur `Yuka_vws_2.0` : l'écran de choix
s'affiche avec ses trois variantes, cocher l'une décoche les autres, les banques
arrivent dans `sound/mod` sous le nom que le jeu lit, `config.blk` gagne sa
ligne, la désactivation vide le dossier et rend le fichier à son état d'origine,
la réactivation ne retélécharge rien.

Et sur deux mods réels qui se disputent `crew_dialogs_common.bank` (`TR_5+`
puis `Ooarai`) : le premier n'affiche rien, le second annonce le recouvrement
avant le téléchargement.

Enfin contre une installation réelle où OPEX 5.0.0 avait été extrait à la main :
l'application annonce « 3 fichiers son déjà présents dans sound/mod seront
remplacés » avant d'installer RTCM. Les trois ont été recoupés à part, en
croisant l'index du zip de RTCM avec le contenu du dossier — ce sont les
dialogues d'équipage allemand, anglais US et français.

## Annexe : les 20 archives relevées

Index de zip lus en requêtes Range, sans télécharger les archives.

Sans question (11 plates, 5 à dossier unique) : [RCSM](https://live.warthunder.com/post/1089792/) ·
[OPEX 5.0.0](https://live.warthunder.com/post/1118327/) ·
[TC6p](https://live.warthunder.com/post/1043311/) ·
[Free-Bird Missile](https://live.warthunder.com/post/1094068/) ·
[TR_5+](https://live.warthunder.com/post/1008051/) ·
[GuP Crew Mod v1.7](https://live.warthunder.com/post/1135605/) ·
[ETSMIV](https://live.warthunder.com/post/1102095/) ·
[RTCM 1.1.7](https://live.warthunder.com/post/1169489/) ·
[FTSm 0.3.2](https://live.warthunder.com/post/921980/) ·
[W_English 1.1.1](https://live.warthunder.com/post/1111694/) ·
[Radio Styled](https://live.warthunder.com/post/911390/) ·
[Yuka vws 2.0](https://live.warthunder.com/post/1098456/) ·
[OPEX crew US](https://live.warthunder.com/post/1153954/) ·
[OPEX crew DE](https://live.warthunder.com/post/1165427/) ·
[PCSM 2.1.15](https://live.warthunder.com/post/1032681/) ·
[Prinz Eugen](https://live.warthunder.com/post/985241/)

À choix : [Ooarai](https://live.warthunder.com/post/896385/) (9 équipages exclusifs + Radio Chat) ·
[Kuromorimine](https://live.warthunder.com/post/895036/) (3 équipages exclusifs + Radio Chat) ·
[IASM v17.5](https://live.warthunder.com/post/1084382/) (22 RWR exclusifs + Step 1) ·
[Girls und Panzer](https://live.warthunder.com/post/1078220/) (5 groupes additifs)
