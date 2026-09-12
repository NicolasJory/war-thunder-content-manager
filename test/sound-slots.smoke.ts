/**
 * Le mixeur : donner un emplacement sonore à un mod, ou le rendre au jeu.
 * `npm run smoke:sound-slots`. Disque réel, aucun réseau.
 *
 * Ce que ce check garde :
 *
 *  1. un emplacement change de main SANS toucher aux autres — c'est toute la
 *     raison d'être du mixeur ;
 *  2. la paire `.bank` / `.assets.bank` se déplace ensemble, et le fichier de
 *     l'ancien occupant s'en va même quand le nouveau n'en fournit qu'un ;
 *  3. rendre une place au jeu vide la ligne, et `enable_mod` suit l'état réel
 *     du dossier plutôt qu'un compteur de mods.
 */

import assert from "assert";
import AdmZip from "adm-zip";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  listSoundSlots,
  reassignClaims,
  setSoundSlot,
  setLibraryDir,
  type InstalledRecord,
  type WtConfig,
} from "../src/main/wtLive.js";
import { parseSlot, slotOf } from "../src/main/soundSlots.js";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

const CONFIG_BLK = ["sound{", "  fmod_sound_enable:b=yes", "}", ""].join("\r\n");

async function makeZip(file: string, entries: Record<string, string>): Promise<void> {
  const zip = new AdmZip();
  for (const [n, b] of Object.entries(entries)) zip.addFile(n, Buffer.from(b));
  await mkdir(path.dirname(file), { recursive: true });
  zip.writeZip(file);
}

const record = (
  lang_group: number,
  name: string,
  zip: string,
  provides: string[],
  files: string[]
): InstalledRecord => ({
  contentType: "sound",
  lang_group,
  path: "",
  name,
  installedAt: 0,
  meta: {
    files,
    groups: [""],
    active: files.length > 0,
    activatedAt: lang_group,
    addedEnableMod: true,
    overwrites: [],
    zip,
    provides,
  },
});

// ------------------------- Découpage des noms ------------------------- //

console.log("\nDécoupage des noms d'emplacement");

assert.equal(slotOf("_crew_dialogs_ground_fr.assets.bank"), "_crew_dialogs_ground_fr.bank");
assert.equal(slotOf("Tank Crew/Duck/crew_dialogs_ground.bank"), "crew_dialogs_ground.bank");
assert.equal(slotOf("MASTERBANK.BANK"), "masterbank.bank");
ok("la paire .bank / .assets.bank désigne un seul emplacement");

assert.deepEqual(parseSlot("_crew_dialogs_ground_fr.bank"), {
  family: "crew_dialogs_ground",
  lang: "fr",
});
assert.deepEqual(parseSlot("_crew_dialogs_ground_en_us.bank"), {
  family: "crew_dialogs_ground",
  lang: "en_us",
});
ok("une famille de dialogues se décompose en famille + langue");

// La banque générique n'a pas de langue : c'est un emplacement fixe.
assert.deepEqual(parseSlot("crew_dialogs_ground.bank"), { fixed: "crew_dialogs_ground" });
assert.deepEqual(parseSlot("tanks_engines.bank"), { fixed: "tanks_engines" });
// `blu` fait trois lettres : ce n'est pas un code de langue, donc pas une famille.
assert.deepEqual(parseSlot("_crew_dialogs_common_blu.bank"), {
  fixed: "_crew_dialogs_common_blu",
});
ok("les emplacements fixes ne sont pas pris pour des variantes de langue");

// ------------------------- Revendication exclusive ------------------------- //
//
// Le défaut que le mixeur a rendu visible : installer un mod par-dessus un
// autre laissait les deux revendiquer les mêmes fichiers. Les cartes
// annonçaient 16 et 17 fichiers pour un dossier qui n'en portait que 17, et le
// mixeur ne savait plus dire à qui appartenait une place.

console.log("\nRevendication exclusive d'un fichier");

{
  const a = record(1, "Mod A", "a.zip", [], ["masterbank.bank", "tanks_engines.bank"]);
  const b = record(2, "Mod B", "b.zip", [], []);

  // B pose masterbank par-dessus celui de A.
  const apres = reassignClaims([a, b], 2, ["masterbank.bank"]);
  const aprA = apres.find((r) => r.lang_group === 1)!.meta as { files: string[]; active: boolean };
  assert.deepEqual(aprA.files, ["tanks_engines.bank"], "A perd la place, garde le reste");
  assert.equal(aprA.active, true, "il lui reste une banque, il est toujours dans le jeu");
  ok("le mod recouvert lâche le fichier pris, pas les autres");

  // Lui prendre tout le sort du jeu.
  const vide = reassignClaims([a, b], 2, ["masterbank.bank", "tanks_engines.bank"]);
  const videA = vide.find((r) => r.lang_group === 1)!.meta as { files: string[]; active: boolean };
  assert.deepEqual(videA.files, []);
  assert.equal(videA.active, false, "plus rien sur le disque : plus dans le jeu");
  ok("mod entièrement recouvert : il sort du jeu au lieu de mentir");

  // Le nouveau propriétaire n'est jamais dépouillé par sa propre pose.
  const soi = reassignClaims([a, b], 1, ["masterbank.bank"]);
  assert.deepEqual(
    (soi.find((r) => r.lang_group === 1)!.meta as { files: string[] }).files,
    ["masterbank.bank", "tanks_engines.bank"]
  );
  ok("le poseur garde ses propres fichiers");

  // La casse, ici aussi : Windows ne distingue pas.
  const casse = reassignClaims([a, b], 2, ["MASTERBANK.BANK"]);
  assert.deepEqual(
    (casse.find((r) => r.lang_group === 1)!.meta as { files: string[] }).files,
    ["tanks_engines.bank"]
  );
  ok("recalage insensible à la casse");
}

// ------------------------- Le mixeur ------------------------- //

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "wt-mix-"));
  const gameDir = path.join(root, "War Thunder");
  const modDir = path.join(gameDir, "sound", "mod");
  const lib = path.join(root, "library");
  await mkdir(path.join(gameDir, "sound"), { recursive: true });
  await writeFile(path.join(gameDir, "config.blk"), CONFIG_BLK, "utf8");
  setLibraryDir(lib);

  // Deux mods qui se disputent les voix françaises, chacun avec ses extras.
  const zipA = path.join(lib, "sound", "1.zip");
  const zipB = path.join(lib, "sound", "2.zip");
  await makeZip(zipA, {
    "_crew_dialogs_ground_fr.bank": "voix fr de A",
    "_crew_dialogs_ground_fr.assets.bank": "audio fr de A",
    "tanks_engines.bank": "moteurs de A",
  });
  await makeZip(zipB, {
    // B ne fournit QUE l'audio : le cas d'OPEX, qui laisse les événements du jeu.
    "_crew_dialogs_ground_fr.assets.bank": "audio fr de B",
    "_crew_dialogs_ground_de.assets.bank": "audio de de B",
  });

  const modA = record(
    1,
    "Mod A",
    zipA,
    [
      "_crew_dialogs_ground_fr.bank",
      "_crew_dialogs_ground_fr.assets.bank",
      "tanks_engines.bank",
    ],
    []
  );
  const modB = record(
    2,
    "Mod B",
    zipB,
    ["_crew_dialogs_ground_fr.assets.bank", "_crew_dialogs_ground_de.assets.bank"],
    []
  );
  const config: WtConfig = { gameDir, installed: [modA, modB] };

  // --- Le tableau ---
  const slots = await listSoundSlots(config);
  assert.deepEqual(
    slots.map((s) => s.slot),
    ["_crew_dialogs_ground_de.bank", "_crew_dialogs_ground_fr.bank", "tanks_engines.bank"]
  );
  const fr = slots.find((s) => s.slot === "_crew_dialogs_ground_fr.bank")!;
  assert.deepEqual(fr.candidates, [1, 2], "les deux mods savent tenir la place");
  assert.equal(fr.owner, null, "personne ne l'occupe encore");
  ok("le tableau liste les places offertes et leurs candidats");

  // --- Donner le français à A ---
  config.installed = await setSoundSlot(config, "_crew_dialogs_ground_fr.bank", 1);
  assert.deepEqual((await readdir(modDir)).sort(), [
    "_crew_dialogs_ground_fr.assets.bank",
    "_crew_dialogs_ground_fr.bank",
  ]);
  assert.equal(
    await readFile(path.join(modDir, "_crew_dialogs_ground_fr.bank"), "utf8"),
    "voix fr de A"
  );
  ok("la paire complète est posée, pas seulement le .bank");

  // --- Passer le français à B, qui ne fournit que l'audio ---
  config.installed = await setSoundSlot(config, "_crew_dialogs_ground_fr.bank", 2);
  assert.deepEqual(
    await readdir(modDir),
    ["_crew_dialogs_ground_fr.assets.bank"],
    "le .bank de A doit partir : sinon il resterait orphelin sur l'audio de B"
  );
  assert.equal(
    await readFile(path.join(modDir, "_crew_dialogs_ground_fr.assets.bank"), "utf8"),
    "audio fr de B"
  );
  ok("changement d'occupant : l'ancien part en entier, même ce que le nouveau ne remplace pas");

  const apres = await listSoundSlots(config);
  assert.equal(apres.find((s) => s.slot === "_crew_dialogs_ground_fr.bank")!.owner, 2);
  assert.equal(
    (config.installed.find((r) => r.lang_group === 1)!.meta as { files: string[] }).files.length,
    0,
    "A ne revendique plus rien"
  );
  ok("la revendication suit : A lâche la place, B la prend");

  // --- Un autre emplacement, sans toucher au premier ---
  config.installed = await setSoundSlot(config, "tanks_engines.bank", 1);
  assert.deepEqual((await readdir(modDir)).sort(), [
    "_crew_dialogs_ground_fr.assets.bank",
    "tanks_engines.bank",
  ]);
  ok("deux mods se partagent le dossier, chacun sur sa place");

  // --- Rendre une place au jeu ---
  config.installed = await setSoundSlot(config, "_crew_dialogs_ground_fr.bank", null);
  assert.deepEqual(await readdir(modDir), ["tanks_engines.bank"]);
  assert(
    (await readFile(path.join(gameDir, "config.blk"), "utf8")).includes("enable_mod:b=yes"),
    "il reste une banque : enable_mod doit rester"
  );
  ok("rendre une place au jeu efface ses fichiers et laisse le reste");

  // --- Vider la dernière ---
  config.installed = await setSoundSlot(config, "tanks_engines.bank", null);
  assert.deepEqual(await readdir(modDir), []);
  assert.equal(
    await readFile(path.join(gameDir, "config.blk"), "utf8"),
    CONFIG_BLK,
    "dossier vide : la ligne que nous avions posée s'en va"
  );
  ok("dernier emplacement rendu : config.blk revient à son état d'origine");

  // --- Une banque posée à la main occupe une vraie place ---
  await writeFile(path.join(modDir, "masterbank.bank"), "pose a la main");
  const avecEtranger = await listSoundSlots(config);
  const master = avecEtranger.find((s) => s.slot === "masterbank.bank")!;
  assert.equal(master.foreign, true);
  assert.equal(master.owner, null);
  assert.deepEqual(master.candidates, [], "aucun mod téléchargé ne peut la remplacer");
  assert.equal(master.risky, true, "le masterbank est signalé comme délicat à panacher");
  ok("banque posée à la main : occupe la place, signalée comme étrangère");

  await rm(root, { recursive: true, force: true });
  console.log(`\n${passed} checks OK — mixeur d'emplacements\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
