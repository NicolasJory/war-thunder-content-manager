/**
 * Check de la config et de la découverte du jeu. `npm run smoke:config`.
 * Tourne en Node nu — config.ts n'importe volontairement pas electron.
 */

import assert from "assert";
import { promises as fs } from "fs";
import { rmSync } from "fs";
import path from "path";
import {
  createConfigStore,
  detectGameDir,
  parseLibraryFolders,
  validateGameDir,
} from "../src/main/config.js";

const SANDBOX = path.resolve(".tmp/cfg");
let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

const VDF = `"libraryfolders"
{
	"0"
	{
		"path"		"C:\\\\Program Files (x86)\\\\Steam"
		"apps"
		{
			"228980"		"409903060"
		}
	}
	"1"
	{
		"path"		"D:\\\\SteamLibrary"
		"apps"
		{
			"236390"		"92407024667"
			"250900"		"1656479617"
		}
	}
}`;

async function main() {
  rmSync(SANDBOX, { recursive: true, force: true });

  console.log("\n[1] Parsing libraryfolders.vdf");
  const libs = parseLibraryFolders(VDF);
  assert.equal(libs.length, 2, "deux bibliotheques attendues");
  assert.equal(libs[0].path, "C:\\Program Files (x86)\\Steam", "backslashes non desechappes");
  assert.equal(libs[1].path, "D:\\SteamLibrary");
  ok("les 2 bibliotheques sont extraites, backslashes desechappes");
  assert(libs[1].apps.includes("236390"), "appid War Thunder manquant");
  assert(!libs[0].apps.includes("236390"), "appid attribue a la mauvaise bibliotheque");
  ok("l'appid 236390 est rattache a la bonne bibliotheque");
  assert.deepEqual(parseLibraryFolders("n'importe quoi"), [], "un vdf illisible doit donner []");
  ok("un vdf illisible renvoie [] au lieu de lever");

  console.log("\n[2] Validation d'un dossier de jeu");
  const fake = path.join(SANDBOX, "War Thunder");
  await fs.mkdir(path.join(fake, "UserSkins"), { recursive: true });

  let res = await validateGameDir(fake);
  assert(!res.ok, "un dossier sans .vromfs.bin doit etre refuse");
  ok("dossier sans marqueur -> refuse");

  await fs.writeFile(path.join(fake, "aces.vromfs.bin"), "x");
  res = await validateGameDir(fake);
  assert(res.ok && res.gameDir === fake, res.reason ?? "");
  ok("racine du jeu -> acceptee");

  res = await validateGameDir(path.join(fake, "UserSkins"));
  assert(res.ok && res.gameDir === fake, "UserSkins doit remonter au parent");
  ok("pointer UserSkins remonte automatiquement a la racine");

  res = await validateGameDir(path.join(SANDBOX, "nexiste_pas"));
  assert(!res.ok && res.reason === "V_NOT_FOUND", `attendu V_NOT_FOUND, recu ${res.reason}`);
  assert.equal(res.detail, path.join(SANDBOX, "nexiste_pas"), "le chemin concerne doit accompagner le code");
  ok("dossier inexistant -> code V_NOT_FOUND + chemin, traduisible cote UI");

  assert(!(await validateGameDir("")).ok);
  assert(!(await validateGameDir("   ")).ok);
  ok("chaine vide -> refusee");

  console.log("\n[3] Persistance");
  const file = path.join(SANDBOX, "userData", "config.json");
  const store = createConfigStore(file);
  assert.deepEqual(await store.get(), { gameDir: "", installed: [], favorites: [] });
  ok("config absente -> config vide, pas de crash");

  await store.set({ gameDir: fake });
  const reread = createConfigStore(file);
  assert.equal((await reread.get()).gameDir, fake, "gameDir non persiste");
  ok("gameDir survit a un redemarrage");

  await store.set({ installed: [{ contentType: "camouflage", lang_group: 1, path: "p", name: "p", installedAt: 0 }] });
  const after = await createConfigStore(file).get();
  assert.equal(after.gameDir, fake, "set() a ecrase gameDir");
  assert.equal(after.installed.length, 1);
  ok("set() fusionne au lieu d'ecraser");

  await store.set({ favorites: [{ id: 7, nickname: "Kriegsmaler", avatar: "", addedAt: 1 }] });
  const withFav = await createConfigStore(file).get();
  assert.equal(withFav.favorites.length, 1, "favoris non persistes");
  assert.equal(withFav.installed.length, 1, "set() a ecrase les installes");
  ok("les favoris persistent sans ecraser le reste");

  await fs.writeFile(file, "{ pas du json");
  assert.deepEqual(await createConfigStore(file).get(), { gameDir: "", installed: [], favorites: [] });
  ok("config corrompue -> config vide au lieu d'un crash au demarrage");

  console.log("\n[4] Auto-detection sur cette machine");
  const detected = await detectGameDir();
  if (detected) {
    const v = await validateGameDir(detected);
    assert(v.ok, "le chemin detecte ne valide pas");
    ok(`detecte : ${detected}`);
  } else {
    console.log("  – aucune install Steam detectee ici (le bouton Parcourir prend le relais)");
  }

  rmSync(SANDBOX, { recursive: true, force: true });
  console.log(`\n${passed} checks OK\n`);
}

main().catch((e) => {
  console.error("\nECHEC :", e.message);
  process.exit(1);
});
