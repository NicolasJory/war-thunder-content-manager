/**
 * Cycle de vie complet d'un mod son, sur de vraies archives et un vrai dossier
 * de jeu factice. Aucun réseau : les zips sont fabriqués ici.
 * `npm run smoke:sound-install`.
 *
 * Ce que ce check garde, et qui casserait en silence autrement :
 *
 *  1. la superposition — deux mods qui livrent `masterbank.bank` cohabitent,
 *     le dernier activé l'emporte, et le désactiver REPOSE la banque de
 *     l'autre au lieu de laisser un trou. Un auteur compte là-dessus : IASM
 *     nomme un de ses dossiers « skip if mixing with RCSM » ;
 *  2. le va-et-vient sur `config.blk` — la ligne `enable_mod` part avec le
 *     dernier mod son, et le fichier retrouve son état d'origine ;
 *  3. la désinstallation — les banques ET l'archive partent, rien ne reste.
 */

import assert from "assert";
import AdmZip from "adm-zip";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, stat } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import {
  getInstaller,
  listForeignBanks,
  setLibraryDir,
  type InstalledRecord,
  type Skin,
  type WtConfig,
} from "../src/main/wtLive.js";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false
  );

/** Le vrai bloc `sound` d'un config.blk de Gaijin, en CRLF. */
const CONFIG_BLK = [
  "video{",
  "  compatibilityMode:b=no",
  "}",
  "sound{",
  "  fmod_sound_enable:b=yes",
  '  speakerMode:t="stereo"',
  "}",
  "",
].join("\r\n");

/** Archive servie depuis le disque : c'est ainsi que l'installeur la lit. */
async function makeZip(file: string, entries: Record<string, string>): Promise<void> {
  const zip = new AdmZip();
  for (const [name, body] of Object.entries(entries)) zip.addFile(name, Buffer.from(body));
  await mkdir(path.dirname(file), { recursive: true });
  zip.writeZip(file);
}

function fakeSkin(langGroup: number, name: string): Skin {
  return {
    id: langGroup,
    lang_group: langGroup,
    likes: 0,
    views: 0,
    downloads: 0,
    comments: 0,
    created: 0,
    type: "sound",
    description: "",
    author: { id: 1, nickname: "test", avatar: "" },
    images: [],
    file: { name, link: "https://live.warthunder.com/unused", size: 0 },
  };
}

async function main() {
  const root = await mkdtemp(path.join(tmpdir(), "wt-sound-"));
  const gameDir = path.join(root, "War Thunder");
  const modDir = path.join(gameDir, "sound", "mod");
  const library = path.join(root, "library");
  await mkdir(gameDir, { recursive: true });
  await writeFile(path.join(gameDir, "config.blk"), CONFIG_BLK, "utf8");
  setLibraryDir(library);

  const installer = getInstaller("sound");
  assert(installer.setActive, "l'installeur son doit savoir activer/désactiver");

  // L'installeur télécharge dans la bibliothèque. Ici on y dépose les archives
  // d'avance : le téléchargement lui-même est couvert par smoke:network.
  await makeZip(path.join(library, "sound", "101.zip"), {
    "masterbank.bank": "banque de A",
    "tanks_engines.bank": "moteurs de A",
  });
  await makeZip(path.join(library, "sound", "202.zip"), {
    "masterbank.bank": "banque de B",
    "aircraft_guns.bank": "canons de B",
  });

  // ------------------------- Mod A ------------------------- //

  const config: WtConfig = { gameDir, installed: [] };
  let recordA = await installer.setActive(
    {
      contentType: "sound",
      lang_group: 101,
      path: modDir,
      name: "Mod A",
      installedAt: Date.now(),
      meta: {
        files: [],
        groups: [""],
        active: false,
        activatedAt: 0,
        addedEnableMod: false,
        overwrites: [],
        zip: path.join(library, "sound", "101.zip"),
      },
    } as InstalledRecord,
    true,
    config
  );
  config.installed = [recordA];

  assert.equal(await readFile(path.join(modDir, "masterbank.bank"), "utf8"), "banque de A");
  assert.equal(await readFile(path.join(modDir, "tanks_engines.bank"), "utf8"), "moteurs de A");
  ok("activation : les banques sont posées à plat dans sound/mod");

  const afterA = await readFile(path.join(gameDir, "config.blk"), "utf8");
  assert(afterA.includes("enable_mod:b=yes"), "config.blk doit autoriser les mods");
  assert(afterA.includes("\r\n"), "les CRLF sont conservés");
  assert(afterA.includes("fmod_sound_enable:b=yes"), "le reste du bloc est intact");
  ok("config.blk : enable_mod posé, CRLF et reste du bloc intacts");

  // ------------------------- Mod B par-dessus ------------------------- //

  let recordB = await installer.setActive(
    {
      contentType: "sound",
      lang_group: 202,
      path: modDir,
      name: "Mod B",
      installedAt: Date.now(),
      meta: {
        files: [],
        groups: [""],
        active: false,
        activatedAt: 0,
        addedEnableMod: false,
        overwrites: [],
        zip: path.join(library, "sound", "202.zip"),
      },
    } as InstalledRecord,
    true,
    config
  );
  config.installed = [recordA, recordB];

  assert.equal(await readFile(path.join(modDir, "masterbank.bank"), "utf8"), "banque de B");
  assert.equal(await readFile(path.join(modDir, "tanks_engines.bank"), "utf8"), "moteurs de A");
  assert.equal(await readFile(path.join(modDir, "aircraft_guns.bank"), "utf8"), "canons de B");
  ok("superposition : B gagne la banque disputée, A garde le reste");

  assert.deepEqual((recordB.meta as { overwrites: string[] }).overwrites, ["Mod A"]);
  ok("le mod recouvert est nommé, l'utilisateur peut le voir");

  // ------------------------- Retrait de B ------------------------- //

  recordB = await installer.setActive(recordB, false, config);
  config.installed = [recordA, recordB];

  assert.equal(
    await readFile(path.join(modDir, "masterbank.bank"), "utf8"),
    "banque de A",
    "la banque de A doit revenir, pas disparaître"
  );
  assert.equal(await exists(path.join(modDir, "aircraft_guns.bank")), false);
  ok("désactivation de B : la banque de A est reposée, celle de B part");

  assert((await readFile(path.join(gameDir, "config.blk"), "utf8")).includes("enable_mod:b=yes"));
  ok("config.blk : enable_mod reste tant qu'un mod son est actif");

  // ------------------------- Retrait de A ------------------------- //

  recordA = await installer.setActive(recordA, false, config);
  config.installed = [recordA, recordB];

  assert.deepEqual(await readdir(modDir), [], "sound/mod doit être vide");
  assert.equal(
    await readFile(path.join(gameDir, "config.blk"), "utf8"),
    CONFIG_BLK,
    "config.blk doit retrouver son état d'origine, à l'octet près"
  );
  ok("dernier mod retiré : config.blk revient exactement à son état d'origine");

  // ------------------------- Désinstallation ------------------------- //

  assert.equal(await exists(path.join(library, "sound", "101.zip")), true);
  ok("désactiver ne touche pas à l'archive : réactiver ne retéléchargera rien");

  await installer.uninstall(recordA, config);
  assert.equal(await exists(path.join(library, "sound", "101.zip")), false);
  ok("désinstaller efface l'archive : rien ne reste sur le disque");

  // Désinstaller un mod actif doit d'abord le retirer du jeu.
  recordB = await installer.setActive(recordB, true, config);
  config.installed = [recordB];
  assert.equal(await exists(path.join(modDir, "masterbank.bank")), true);

  await installer.uninstall(recordB, config);
  assert.deepEqual(await readdir(modDir), [], "les banques du mod actif doivent partir aussi");
  assert.equal(await exists(path.join(library, "sound", "202.zip")), false);
  assert.equal(
    await readFile(path.join(gameDir, "config.blk"), "utf8"),
    CONFIG_BLK,
    "config.blk revient à son état d'origine"
  );
  ok("désinstaller un mod actif : banques, archive et ligne de config partent ensemble");

  // ------------------------- Banques posées hors de l'application ------------------------- //
  //
  // Le cas rencontré en vrai : un joueur qui extrayait ses mods à la main avant
  // d'avoir l'application. Ces banques doivent être VUES — sinon l'avertissement
  // de recouvrement est aveugle — et JAMAIS touchées, elles ne sont pas à nous.

  // Deux banques posées à la main, comme après une extraction de zip.
  config.installed = [];
  await writeFile(path.join(modDir, "masterbank.bank"), "pose a la main");
  await writeFile(path.join(modDir, "tanks_engines.bank"), "pose a la main");

  assert.deepEqual(await listForeignBanks(config), ["masterbank.bank", "tanks_engines.bank"]);
  ok("banques posées à la main : vues par listForeignBanks");

  // Un mod à nous par-dessus : sa banque sort de la liste, l'autre y reste.
  await makeZip(path.join(library, "sound", "303.zip"), { "masterbank.bank": "banque de C" });
  let recordC = await installer.setActive(
    {
      contentType: "sound",
      lang_group: 303,
      path: modDir,
      name: "Mod C",
      installedAt: Date.now(),
      meta: {
        files: [],
        groups: [""],
        active: false,
        activatedAt: 0,
        addedEnableMod: false,
        overwrites: [],
        zip: path.join(library, "sound", "303.zip"),
      },
    } as InstalledRecord,
    true,
    config
  );
  config.installed = [recordC];
  assert.deepEqual(
    await listForeignBanks(config),
    ["tanks_engines.bank"],
    "masterbank est désormais à nous, tanks_engines ne l'est pas"
  );
  ok("après notre pose : seules les banques encore étrangères restent listées");

  // Un mod sorti du jeu ne revendique plus rien : ce qui porte son nom sur le
  // disque n'est plus le sien.
  recordC = await installer.setActive(recordC, false, config);
  config.installed = [recordC];
  await writeFile(path.join(modDir, "masterbank.bank"), "remis a la main");
  assert.deepEqual(await listForeignBanks(config), ["masterbank.bank", "tanks_engines.bank"]);
  ok("mod désactivé : ce qui reste sur le disque redevient étranger");

  // Le contrat : on les liste, on ne les efface jamais.
  await installer.uninstall(recordC, config);
  assert.deepEqual(
    (await readdir(modDir)).sort(),
    ["masterbank.bank", "tanks_engines.bank"],
    "une désinstallation ne doit pas emporter ce que nous n'avons pas posé"
  );
  ok("désinstallation : les banques étrangères restent intactes");

  await rm(root, { recursive: true, force: true });
  console.log(`\n${passed} checks OK — cycle de vie du son complet\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
