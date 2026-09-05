/**
 * Sécurité du désinstalleur de viseurs face aux dossiers de véhicules
 * partagés entre paquets. Pur système de fichiers, aucun réseau : se lance
 * partout. `npm run smoke:sight-overwrite`.
 *
 * Le scénario : deux paquets écrivent tous les deux `t-34/default.blk` (un
 * dossier de véhicule est partagé, rien d'anormal). Désinstaller le premier
 * ne doit pas emporter le fichier que le second réclame aussi.
 */

import assert from "assert";
import { mkdtemp, mkdir, writeFile, rm, readdir } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { getInstaller, type InstalledRecord, type WtConfig } from "../src/main/wtLive.js";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

async function main() {
  const dest = await mkdtemp(path.join(tmpdir(), "wt-sight-"));
  await mkdir(path.join(dest, "t-34"), { recursive: true });
  await mkdir(path.join(dest, "is-2"), { recursive: true });
  await writeFile(path.join(dest, "t-34", "default.blk"), "pack A");
  await writeFile(path.join(dest, "is-2", "default.blk"), "pack A only");

  const packA: InstalledRecord = {
    contentType: "sight",
    lang_group: 1,
    path: dest,
    name: "Pack A",
    installedAt: Date.now(),
    meta: { files: ["t-34/default.blk", "is-2/default.blk"], via: "vehicles" },
  };
  // Pack B écrase t-34/default.blk (dossier de véhicule partagé) mais ne
  // touche pas is-2.
  await writeFile(path.join(dest, "t-34", "default.blk"), "pack B");
  const packB: InstalledRecord = {
    contentType: "sight",
    lang_group: 2,
    path: dest,
    name: "Pack B",
    installedAt: Date.now(),
    meta: { files: ["t-34/default.blk"], via: "vehicles" },
  };

  const installer = getInstaller("sight");
  const config: WtConfig = { gameDir: "", installed: [packA, packB] };

  // Désinstaller A : is-2/default.blk (n'appartient qu'à A) doit partir,
  // t-34/default.blk (réclamé par B aussi) doit rester intact.
  await installer.uninstall(packA, config);

  const remaining = await readdir(dest, { recursive: true } as never);
  assert(!remaining.includes(path.join("is-2", "default.blk")), "is-2/default.blk aurait dû partir");
  ok("fichier propre à A retiré");

  assert(remaining.includes(path.join("t-34", "default.blk")), "t-34/default.blk aurait dû rester");
  ok("fichier partagé avec B laissé en place");

  const { readFile } = await import("fs/promises");
  const content = await readFile(path.join(dest, "t-34", "default.blk"), "utf8");
  assert.equal(content, "pack B", "le contenu de B a été altéré");
  ok("le contenu appartenant à B n'a pas été touché");

  await rm(dest, { recursive: true, force: true });
  console.log(`\n${passed} checks OK — désinstallation sûre face aux dossiers partagés\n`);
}

main().catch((e) => {
  console.error("\nECHEC :", (e as Error).message);
  process.exit(1);
});
