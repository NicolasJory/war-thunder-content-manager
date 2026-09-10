/**
 * Check du classement des archives son et du patch de config.blk.
 * `npm run smoke:sound`. Tourne en Node nu : soundLayout.ts est pur.
 *
 * Les jeux d'entrées reproduisent quatre archives réelles, relevées sur Live
 * en lisant l'index des zips (voir docs/superpowers/specs/2026-09-09-sound-mods-design.md) :
 *   RCSM              https://live.warthunder.com/post/1089792/   banques à plat
 *   TC6p              https://live.warthunder.com/post/1043311/   un dossier `mod/`
 *   Girls und Panzer  https://live.warthunder.com/post/1078220/   dossiers additifs
 *   Ooarai            https://live.warthunder.com/post/896385/    équipages exclusifs
 */

import assert from "assert";
import {
  defaultSelection,
  isValidSelection,
  patchSoundBlock,
  planSoundLayout,
  soundEntriesFor,
  targetName,
} from "../src/main/soundLayout.js";
import { coveredBy } from "../src/renderer/src/api.js";
import type { InstalledRecord } from "../src/main/wtLive.js";

let passed = 0;
const ok = (label: string) => {
  passed++;
  console.log(`  ✓ ${label}`);
};

// ------------------------- Classement des archives ------------------------- //

console.log("\nClassement des archives");

// RCSM : tout à la racine.
{
  const plan = planSoundLayout([
    "masterbank.bank",
    "masterbank.strings.bank",
    "tanks_engines.bank",
    "tanks_engines.assets.bank",
  ]);
  assert(plan, "RCSM devrait donner un plan");
  assert.equal(plan.strip, "");
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].dir, "");
  assert.equal(plan.needsChoice, false);
  ok("archive plate : un seul groupe, aucune question");
}

// TC6p : un dossier d'emballage, qui doit disparaître du plan.
{
  const plan = planSoundLayout(["mod/", "mod/aircraft_music.bank", "mod/crew_dialogs_common.bank"]);
  assert(plan);
  assert.equal(plan.strip, "mod/");
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].dir, "");
  assert.equal(plan.needsChoice, false);
  ok("dossier racine unique : retiré, aucune question");
}

// Girls und Panzer : cinq dossiers, aucun nom de fichier en commun.
{
  const root = "Girls und Panzer (War Thunder Sound Mod)/";
  const plan = planSoundLayout([
    `${root}Background music/aircraft_music.bank`,
    `${root}Planes/dialogs_chat_en.assets.bank`,
    `${root}Radio Chat/crew_dialogs_common.bank`,
    `${root}Ships/_crew_dialogs_naval_en.assets.bank`,
    `${root}Tanks/crew_dialogs_ground.bank`,
  ]);
  assert(plan);
  assert.equal(plan.strip, root);
  assert.equal(plan.groups.length, 5);
  assert.equal(plan.needsChoice, false);
  assert.deepEqual(
    plan.groups.map((g) => g.dir),
    ["Background music", "Planes", "Radio Chat", "Ships", "Tanks"]
  );
  assert(plan.groups.every((g) => g.clashesWith.length === 0));
  ok("dossiers additifs : cinq groupes, aucun conflit");
}

// Ooarai : les équipages portent les mêmes banques, Radio Chat non.
{
  const plan = planSoundLayout([
    "Radio Chat/crew_dialogs_common.bank",
    "Radio Chat/_crew_dialogs_common_en.bank",
    "Tank Crew/Anglerfish/crew_dialogs_ground.bank",
    "Tank Crew/Anglerfish/_crew_dialogs_ground_en.bank",
    "Tank Crew/Duck/crew_dialogs_ground.bank",
    "Tank Crew/Duck/_crew_dialogs_ground_en.bank",
  ]);
  assert(plan);
  assert.equal(plan.strip, "");
  assert.equal(plan.needsChoice, true);

  const duck = plan.groups.find((g) => g.dir === "Tank Crew/Duck");
  const angler = plan.groups.find((g) => g.dir === "Tank Crew/Anglerfish");
  const radio = plan.groups.find((g) => g.dir === "Radio Chat");
  assert(duck && angler && radio);
  assert.deepEqual(duck.clashesWith, ["Tank Crew/Anglerfish"]);
  assert.deepEqual(angler.clashesWith, ["Tank Crew/Duck"]);
  assert.deepEqual(radio.clashesWith, []);
  ok("équipages exclusifs : conflit repéré, Radio Chat épargné");
}

// Le faux ami : deux langues ne s'excluent pas, ce sont deux fichiers.
{
  const plan = planSoundLayout([
    "_crew_dialogs_ground_en.bank",
    "_crew_dialogs_ground_ru.bank",
    "_crew_dialogs_ground_de.bank",
  ]);
  assert(plan);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.needsChoice, false);
  ok("variantes de langue : un seul groupe, elles s'additionnent");
}

// Casse : Windows ne distingue pas, le conflit doit être vu quand même.
{
  const plan = planSoundLayout(["A/Masterbank.bank", "B/masterbank.bank"]);
  assert(plan);
  assert.equal(plan.needsChoice, true);
  ok("conflit repéré malgré une casse différente");
}

// Archive sans banque : refusée plutôt que posée au hasard.
{
  assert.equal(planSoundLayout(["readme.txt", "capture.jpg"]), null);
  assert.equal(planSoundLayout([]), null);
  ok("archive sans banque : refusée");
}

// Résidus macOS : ils donneraient un groupe fantôme en conflit avec le vrai.
{
  const plan = planSoundLayout([
    "masterbank.bank",
    "__MACOSX/._masterbank.bank",
    "._masterbank.bank",
  ]);
  assert(plan);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].entries.length, 1);
  assert.equal(plan.needsChoice, false);
  ok("résidus macOS ignorés");
}

// ------------------------- Variantes préfixées ------------------------- //

console.log("\nVariantes distinguées par un préfixe");

/** Extrait du catalogue réel de `<jeu>/sound` (275 fichiers sur une install). */
const STOCK = [
  "aircraft_gui.bank",
  "aircraft_gui.assets.bank",
  "masterbank.bank",
  "_crew_dialogs_ground_en.bank",
  "_crew_dialogs_ground_ru.bank",
  "_dialogs_en.bank",
];

// Yuka_vws_2.0 — https://live.warthunder.com/post/1098456/
// Trois doublages du même fichier, posés tels quels le jeu n'en lirait aucun.
{
  const entries = [
    "Chinese_aircraft_gui.assets.bank",
    "Chinese_aircraft_gui.bank",
    "English_aircraft_gui.assets.bank",
    "English_aircraft_gui.bank",
    "Japanese_aircraft_gui.assets.bank",
    "Japanese_aircraft_gui.bank",
  ];

  // Sans catalogue, rien ne permet de voir le problème : un seul groupe.
  const blind = planSoundLayout(entries);
  assert(blind);
  assert.equal(blind.groups.length, 1);
  assert.equal(blind.needsChoice, false);
  ok("sans catalogue de banques : les variantes passent inaperçues");

  const plan = planSoundLayout(entries, STOCK);
  assert(plan);
  assert.equal(plan.groups.length, 3);
  assert.equal(plan.needsChoice, true);
  assert.deepEqual(
    plan.groups.map((g) => g.dir),
    ["Chinese", "English", "Japanese"]
  );
  ok("avec catalogue : trois variantes exclusives, un choix demandé");

  const english = plan.groups.find((g) => g.dir === "English")!;
  assert.deepEqual(english.files.sort(), ["aircraft_gui.assets.bank", "aircraft_gui.bank"]);
  assert.equal(targetName(plan, "English_aircraft_gui.bank"), "aircraft_gui.bank");
  ok("la variante retenue est posée sous le nom que le jeu lit vraiment");

  assert.equal(isValidSelection(plan, ["English", "Japanese"]), false);
  assert.equal(isValidSelection(plan, ["English"]), true);
  assert.deepEqual(defaultSelection(plan), ["Chinese"]);
  ok("deux doublages ensemble : refusé");
}

// Le faux positif à éviter : une langue absente de CETTE installation.
// `_crew_dialogs_ground_ja.bank` suit le nommage d'origine, le jeu le lira si
// le japonais est choisi. Le poser tel quel est le bon comportement.
{
  const plan = planSoundLayout(
    [
      "_crew_dialogs_ground_en.bank",
      "_crew_dialogs_ground_ru.bank",
      "_crew_dialogs_ground_ja.bank",
    ],
    STOCK
  );
  assert(plan);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.needsChoice, false);
  assert.deepEqual(plan.renames, {});
  assert.equal(targetName(plan, "_crew_dialogs_ground_ja.bank"), "_crew_dialogs_ground_ja.bank");
  ok("langue absente du catalogue : posée telle quelle, aucun renommage");
}

// Un seul fichier préfixé n'est pas une famille de variantes : c'est plus
// probablement une banque que le mod ajoute pour son compte.
{
  const plan = planSoundLayout(["masterbank.bank", "reverb_masterbank.bank"], STOCK);
  assert(plan);
  assert.equal(plan.groups.length, 1);
  assert.deepEqual(plan.renames, {});
  ok("un seul préfixe : pas de famille, rien n'est renommé");
}

// Variantes préfixées ET fichiers ordinaires dans la même archive.
{
  const plan = planSoundLayout(
    ["masterbank.bank", "Loud_aircraft_gui.bank", "Quiet_aircraft_gui.bank"],
    STOCK
  );
  assert(plan);
  assert.equal(plan.groups.length, 3);
  const commun = plan.groups.find((g) => g.dir === "")!;
  assert.deepEqual(commun.files, ["masterbank.bank"]);
  assert.deepEqual(commun.clashesWith, []);
  assert.deepEqual(defaultSelection(plan), ["", "Loud"]);
  ok("fichiers communs et variantes cohabitent : les communs restent cochés");
}

// ------------------------- Sélection ------------------------- //

console.log("\nSélection de dossiers");

{
  const plan = planSoundLayout([
    "Radio Chat/crew_dialogs_common.bank",
    "Tank Crew/Anglerfish/crew_dialogs_ground.bank",
    "Tank Crew/Duck/crew_dialogs_ground.bank",
  ])!;

  assert.equal(isValidSelection(plan, ["Radio Chat", "Tank Crew/Duck"]), true);
  assert.equal(isValidSelection(plan, ["Tank Crew/Duck", "Tank Crew/Anglerfish"]), false);
  assert.equal(isValidSelection(plan, []), false);
  ok("deux équipages ensemble : refusé ; un équipage + Radio Chat : accepté");

  assert.deepEqual(soundEntriesFor(plan, ["Tank Crew/Duck"]), [
    "Tank Crew/Duck/crew_dialogs_ground.bank",
  ]);
  assert.equal(soundEntriesFor(plan).length, 3);
  ok("sélection absente : tout est pris");

  // Tout ce qui s'additionne, plus UN équipage.
  const def = defaultSelection(plan);
  assert.deepEqual(def, ["Radio Chat", "Tank Crew/Anglerfish"]);
  assert.equal(isValidSelection(plan, def), true);
  ok("sélection par défaut : additifs + un seul de chaque famille exclusive");
}

// Sans aucun conflit, la sélection par défaut prend tous les groupes.
{
  const plan = planSoundLayout(["A/x.bank", "B/y.bank", "C/z.bank"])!;
  assert.deepEqual(defaultSelection(plan), ["A", "B", "C"]);
  ok("sélection par défaut sans conflit : tout est coché");
}

// ------------------------- Patch de config.blk ------------------------- //

console.log("\nPatch de config.blk");

// Le vrai fichier du jeu, en CRLF, bloc sound au milieu d'autres blocs.
const REAL = [
  "video{",
  "  compatibilityMode:b=no",
  "}",
  "sound{",
  "  fmod_sound_enable:b=yes",
  '  speakerMode:t="stereo"',
  "}",
  "debug{",
  "  fpsLimit:i=0",
  "}",
  "",
].join("\r\n");

{
  const { text, changed } = patchSoundBlock(REAL, true);
  assert.equal(changed, true);
  assert(text.includes("enable_mod:b=yes"));
  assert(text.includes("\r\n  enable_mod:b=yes"), "indentation et CRLF repris");
  assert(!text.includes("\n\n"), "aucune ligne vide introduite");
  assert(text.includes("fmod_sound_enable:b=yes"), "le reste du bloc est intact");
  assert(text.includes("compatibilityMode"), "les autres blocs sont intacts");
  assert.equal((text.match(/\r\n/g) ?? []).length, (REAL.match(/\r\n/g) ?? []).length + 1);
  ok("ajout : ligne posée dans le bloc sound, CRLF et indentation conservés");
}

{
  const enabled = patchSoundBlock(REAL, true).text;
  const again = patchSoundBlock(enabled, true);
  assert.equal(again.changed, false);
  assert.equal(again.text, enabled);
  ok("ajout deux fois : la seconde ne touche à rien");
}

{
  const enabled = patchSoundBlock(REAL, true).text;
  const { text, changed } = patchSoundBlock(enabled, false);
  assert.equal(changed, true);
  assert.equal(text, REAL, "aller-retour : le fichier retrouve son état d'origine");
  ok("retrait : le fichier revient exactement à son état d'origine");
}

{
  const { text, changed } = patchSoundBlock(REAL, false);
  assert.equal(changed, false);
  assert.equal(text, REAL);
  ok("retrait sans ligne à retirer : rien ne bouge");
}

// `enable_mod` déjà posé à la main par le joueur : elle n'est pas à nous.
{
  const manual = REAL.replace("sound{\r\n", "sound{\r\n  enable_mod:b=yes\r\n");
  const added = patchSoundBlock(manual, true);
  assert.equal(added.changed, false, "on ne la repose pas");
  assert.equal(added.text, manual);
  ok("ligne déjà posée par le joueur : changed=false, donc on ne la retirera pas");
}

// Fichier en LF : on ne doit pas y injecter du CRLF.
{
  const lf = REAL.replace(/\r\n/g, "\n");
  const { text } = patchSoundBlock(lf, true);
  assert(!text.includes("\r"), "aucun CR introduit dans un fichier LF");
  assert.equal(patchSoundBlock(text, false).text, lf);
  ok("fichier en LF : reste en LF, aller-retour propre");
}

// Bloc sound absent : on l'écrit, et l'aller-retour laisse le bloc vide en place.
{
  const none = "video{\r\n  compatibilityMode:b=no\r\n}\r\n";
  const { text, changed } = patchSoundBlock(none, true);
  assert.equal(changed, true);
  assert(text.includes("sound{"));
  assert(text.includes("enable_mod:b=yes"));
  assert(text.startsWith(none), "le contenu d'origine n'est pas touché");
  ok("bloc sound absent : créé à la suite");

  assert.equal(patchSoundBlock("", false).changed, false);
  ok("fichier vide, retrait : rien à faire");
}

// Accolades imbriquées : la fermeture du bloc doit être la bonne.
{
  const nested = "sound{\r\n  fx{\r\n    reverb:b=no\r\n  }\r\n}\r\nvideo{\r\n  x:i=1\r\n}\r\n";
  const { text, changed } = patchSoundBlock(nested, true);
  assert.equal(changed, true);
  const soundEnd = text.indexOf("}\r\nvideo{");
  assert(text.indexOf("enable_mod") < soundEnd, "la ligne est bien DANS le bloc sound");
  assert.equal(patchSoundBlock(text, false).text, nested);
  ok("accolades imbriquées : la ligne atterrit dans le bon bloc");
}

// Bloc jamais refermé : fichier abîmé, on n'y touche pas.
{
  const broken = "sound{\r\n  fmod_sound_enable:b=yes\r\n";
  const { changed } = patchSoundBlock(broken, false);
  assert.equal(changed, false);
  ok("accolade jamais refermée : aucun retrait tenté");
}

// ------------------------- Recouvrement d'un mod actif ------------------------- //

console.log("\nAvertissement de recouvrement");

/** Un mod son suivi, dans l'état où l'application le persiste. */
const soundRecord = (
  lang_group: number,
  name: string,
  files: string[],
  active: boolean
): InstalledRecord => ({
  contentType: "sound",
  lang_group,
  path: "sound/mod",
  name,
  installedAt: 0,
  meta: { files, groups: [""], active, activatedAt: lang_group, addedEnableMod: false, overwrites: [], zip: "" },
});

{
  const rcsm = soundRecord(1, "RCSM", ["masterbank.bank", "tanks_engines.bank"], true);
  const solo = soundRecord(2, "Free-Bird", ["aircraft_guns.bank"], true);
  const dormant = soundRecord(3, "OPEX", ["masterbank.bank"], false);
  const installed = [rcsm, solo, dormant];

  // Une banque commune : RCSM perd masterbank, garde ses moteurs.
  const partiel = coveredBy(["masterbank.bank"], installed);
  assert.deepEqual(partiel, [{ name: "RCSM", total: false }]);
  ok("recouvrement partiel : le mod est nommé, marqué non-total");

  // Toutes ses banques : RCSM ne jouerait plus rien.
  const complet = coveredBy(["masterbank.bank", "tanks_engines.bank"], installed);
  assert.deepEqual(complet, [{ name: "RCSM", total: true }]);
  ok("recouvrement complet : marqué total, la phrase changera");

  // La casse ne doit pas faire manquer un conflit : Windows ne distingue pas.
  assert.deepEqual(coveredBy(["MasterBank.bank"], installed), [{ name: "RCSM", total: false }]);
  ok("recouvrement repéré malgré une casse différente");

  // Un mod téléchargé mais sorti du jeu ne peut rien perdre.
  assert.deepEqual(coveredBy(["masterbank.bank"], [dormant]), []);
  ok("mod inactif : jamais signalé, il n'est pas dans le jeu");

  // On ne se signale pas soi-même lors d'une réinstallation.
  assert.deepEqual(coveredBy(["masterbank.bank"], installed, 1), []);
  ok("réinstallation du même mod : il ne se recouvre pas lui-même");

  // Aucun nom en commun : rien à dire.
  assert.deepEqual(coveredBy(["hangar.bank"], installed), []);
  ok("aucune banque commune : aucun avertissement");

  // Plusieurs mods touchés d'un coup, chacun avec son verdict.
  const deux = coveredBy(["masterbank.bank", "tanks_engines.bank", "aircraft_guns.bank"], installed);
  assert.deepEqual(deux, [
    { name: "RCSM", total: true },
    { name: "Free-Bird", total: true },
  ]);
  ok("plusieurs mods touchés : chacun rend son propre verdict");
}

console.log(`\n${passed} checks OK\n`);
