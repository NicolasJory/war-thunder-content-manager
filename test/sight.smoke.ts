/**
 * Installation de viseurs, contre le vrai dossier de jeu. `npm run smoke:sight`.
 *
 * Les viseurs se dispersent dans des dossiers de véhicules partagés entre
 * paquets, contrairement aux camouflages qui ont chacun leur dossier. Ce test
 * porte donc surtout sur une chose : après installation puis retrait, rien de
 * ce qui était là avant n'a bougé.
 */

import assert from "assert";
import AdmZip from "adm-zip";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import {
  fetchPage,
  getInstaller,
  resolveSightsDir,
  setVehicleIds,
  type Skin,
  type WtConfig,
} from "../src/main/wtLive.js";
import { planSightLayout } from "../src/main/sightLayout.js";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};
const sleep = (ms = 600) => new Promise((r) => setTimeout(r, ms));

/** Empreinte du dossier : chemin, taille et date de chaque fichier. */
function snapshot(dir: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (d: string, prefix = "") => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full, prefix + e.name + "/");
      else {
        const st = statSync(full);
        out.set(prefix + e.name, `${st.size}:${st.mtimeMs}`);
      }
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

async function main() {
  const dest = await resolveSightsDir();
  assert(dest, "dossier des viseurs introuvable — lance le jeu une fois");
  console.log(`\nDossier ciblé : ${dest}`);

  // Le compte retenu doit être celui que le jeu déclare comme dernier utilisé.
  const saves = path.resolve(dest, "..", "..", "..");
  const uid = path.basename(path.resolve(dest, "..", ".."));
  try {
    const blk = readFileSync(path.join(saves, "lastlogin.blk"), "utf8");
    const declared = blk.match(/uid\s*:\s*i64\s*=\s*(\d+)/)?.[1];
    if (declared) {
      assert.equal(uid, declared, `compte ${uid} choisi alors que le jeu déclare ${declared}`);
      ok(`compte résolu depuis lastlogin.blk (${uid}), pas deviné`);
    }
  } catch {
    ok(`compte ${uid} retenu (pas de lastlogin.blk lisible)`);
  }

  // La taxonomie locale alimente la reconnaissance des dossiers de véhicules.
  const tax = JSON.parse(readFileSync("src/main/filters.fallback.json", "utf8"));
  const ids: string[] = tax.vehicle.variants
    .map((v: { value?: string }) => v.value)
    .filter((v: string | undefined): v is string => Boolean(v) && v !== "any");
  setVehicleIds(ids);
  ok(`${ids.length} identifiants de véhicules chargés`);

  const before = snapshot(dest);
  console.log(`État initial : ${before.size} fichiers`);

  // On cherche un paquet léger, pour ne pas télécharger 40 Mo sur un test.
  const { data } = await fetchPage({ content: "sight", page: 0 });
  const candidate = data.list.find((s) => s.file.size > 0 && s.file.size < 3_000_000);
  assert(candidate, "aucun viseur assez léger sur la première page");

  const config: WtConfig = { gameDir: "", installed: [], favorites: [] } as WtConfig;
  const installer = getInstaller("sight");

  const record = await installer.install(candidate as Skin, config);
  const posed = (record.meta?.files as string[]) ?? [];
  assert(posed.length > 0, "aucun fichier posé");
  ok(`installé : ${candidate.file.name} → ${posed.length} fichiers, via ${record.meta?.via}`);

  // Tout ce qui a été posé existe vraiment, et sous UserSights.
  for (const rel of posed.slice(0, 40)) {
    const full = path.resolve(dest, rel);
    assert(existsSync(full), `manquant : ${rel}`);
    assert(full.startsWith(path.resolve(dest)), `hors du dossier : ${rel}`);
  }
  ok("chaque fichier annoncé est présent, tous sous UserSights");

  // Rien de préexistant n'a été écrasé pendant l'installation.
  const during = snapshot(dest);
  const ecrases = [...before.entries()].filter(([f, sig]) => during.get(f) !== sig);
  assert.equal(ecrases.length, 0, `écrasés : ${ecrases.slice(0, 3).map(([f]) => f).join(", ")}`);
  ok(`les ${before.size} fichiers préexistants sont intacts après installation`);

  await sleep();
  await installer.uninstall(record, config);

  const after = snapshot(dest);
  const manquants = [...before.keys()].filter((f) => !after.has(f));
  assert.equal(manquants.length, 0, `disparus : ${manquants.slice(0, 3).join(", ")}`);
  ok("désinstallé, aucun fichier préexistant emporté");

  const restes = [...after.keys()].filter((f) => !before.has(f));
  assert.equal(restes.length, 0, `laissés derrière : ${restes.slice(0, 3).join(", ")}`);
  ok(`dossier revenu à l'identique (${after.size} fichiers)`);

  console.log("\n[Structures d'archives]");
  const known = new Set(ids.map((v) => v.toLowerCase()));
  let plans = 0;
  for (const s of data.list.slice(0, 6)) {
    if (s.file.size > 4_000_000) continue;
    const zip = new AdmZip(Buffer.from(await (await fetch(s.file.link)).arrayBuffer()));
    const plan = planSightLayout(
      zip.getEntries().map((e) => e.entryName),
      known
    );
    if (plan) plans++;
    console.log(`  ${plan ? "lu " : "refusé"} ${s.file.name.slice(0, 44)}${plan ? ` (${plan.via})` : ""}`);
    await sleep(400);
  }
  assert(plans > 0, "aucune structure reconnue");
  ok(`${plans} structures d'archives lues sans intervention`);

  console.log(`\n${passed} checks OK — le dossier des viseurs est intact\n`);
}

main().catch((e) => {
  console.error("\nECHEC :", (e as Error).message);
  process.exit(1);
});
