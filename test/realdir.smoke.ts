/**
 * Vérification contre la VRAIE installation du jeu. `npm run smoke:real`.
 *
 * Installe un camouflage dans le UserSkins réel puis le retire, en prouvant que
 * rien de préexistant n'a bougé — les dossiers template_* livrés par Gaijin
 * comme tout ce que le joueur y a mis à la main.
 *
 * Sécurité : si l'archive veut atterrir sur un dossier qui existait déjà, on
 * s'arrête AVANT de désinstaller. Mieux vaut laisser un dossier en trop que
 * supprimer quelque chose qui ne nous appartient pas.
 */

import assert from "assert";
import { existsSync, readdirSync } from "fs";
import path from "path";
import { detectGameDir, validateGameDir } from "../src/main/config.js";
import { fetchPage, getInstaller, type WtConfig } from "../src/main/wtLive.js";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

async function main() {
  const arg = process.argv[2];
  const gameDir = arg ? (await validateGameDir(arg)).gameDir : await detectGameDir();
  assert(gameDir, "installation War Thunder introuvable — passe le chemin en argument");
  console.log(`\nInstallation ciblée : ${gameDir}`);

  const config: WtConfig = { gameDir, installed: [] };
  const dest = await getInstaller("camouflage").resolveDestination(config);
  const before = existsSync(dest) ? readdirSync(dest).sort() : [];
  console.log(`UserSkins avant : ${before.length} entrées [${before.join(", ")}]`);

  const { data } = await fetchPage({ page: 0 });
  const skin = data.list.find((s) => s.file.size < 8_000_000);
  assert(skin, "aucun skin assez léger sur la première page");

  const rec = await getInstaller("camouflage").install(skin, config);
  const name = path.basename(rec.path);
  ok(`installé : ${skin.file.name} -> UserSkins\\${name}`);

  assert(existsSync(rec.path), "le dossier installé n'existe pas");
  assert(
    !before.includes(name),
    `ABANDON : ${name} existait deja, on ne desinstalle pas pour ne rien detruire`
  );
  ok("le dossier créé n'écrase rien de préexistant");

  const during = readdirSync(dest).sort();
  assert.deepEqual(
    during.filter((e) => e !== name),
    before,
    "l'installation a modifié des entrées préexistantes"
  );
  ok("les entrées préexistantes sont intactes après installation");

  await getInstaller(rec.contentType).uninstall(rec, config);
  assert(!existsSync(rec.path), "le dossier subsiste après désinstallation");
  ok("désinstallé");

  assert.deepEqual(readdirSync(dest).sort(), before, "UserSkins ne retrouve pas son état initial");
  ok(`UserSkins revenu à l'identique (${before.length} entrées, dont les template_*)`);

  console.log(`\n${passed} checks OK — le vrai dossier de jeu est intact\n`);
}

main().catch((e) => {
  console.error("\nECHEC :", e.message);
  process.exit(1);
});
