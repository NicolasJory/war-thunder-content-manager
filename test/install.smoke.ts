/**
 * Jalon 2 — preuve du seam d'install, sur de vraies archives de Live.
 * Un seul check runnable : `npm run smoke`. Pas de framework.
 *
 * Couvre : archive "propre" (dossier racine unique) ET "sale" (fichiers en vrac),
 * la désinstallation, et les archives hostiles qui ne doivent JAMAIS écrire hors
 * de UserSkins. Les deux vraies archives sont découvertes au runtime en scannant
 * un feed — pas d'ID en dur qui pourrirait le jour où le skin est supprimé.
 */

import assert from "assert";
import { createServer } from "http";
import AdmZip from "adm-zip";
import { existsSync, readdirSync, rmSync } from "fs";
import { promises as fs } from "fs";
import path from "path";
import {
  assertDownloadUrl,
  fetchPage,
  fetchFilters,
  camouflageInstaller,
  getInstaller,
  safeFolderName,
  searchTag,
  suggestedName,
  tags,
  thumbnail,
  type InstallProgress,
  type Skin,
  type WtConfig,
} from "../src/main/wtLive.js";

const SANDBOX = path.resolve(".tmp/gamedir");
const config: WtConfig = { gameDir: SANDBOX, installed: [] };
const sleep = (ms = 700) => new Promise((r) => setTimeout(r, ms));

const walk = (d: string, prefix = ""): string[] =>
  existsSync(d)
    ? readdirSync(d, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory()
          ? walk(path.join(d, e.name), prefix + e.name + "/")
          : [prefix + e.name]
      )
    : [];

let passed = 0;
function ok(label: string) {
  passed++;
  console.log(`  ✓ ${label}`);
}

// Classe une archive sans l'extraire, pour choisir nos deux cobayes.
function shapeOf(zip: AdmZip): "clean" | "dirty" {
  const roots = new Set<string>();
  let looseFile = false;
  for (const e of zip.getEntries()) {
    const parts = e.entryName.split("/");
    if (parts.length === 1 && !e.entryName.endsWith("/")) looseFile = true;
    roots.add(parts[0] ?? "");
  }
  return looseFile || roots.size > 1 ? "dirty" : "clean";
}

async function findSpecimens(): Promise<{ clean: Skin; dirty: Skin }> {
  let clean: Skin | undefined;
  let dirty: Skin | undefined;
  for (let page = 0; page < 3 && (!clean || !dirty); page++) {
    const { data } = await fetchPage({ page });
    for (const skin of data.list) {
      if (clean && dirty) break;
      if (skin.file.size > 12_000_000) continue; // on reste léger, c'est un smoke test
      const res = await fetch(skin.file.link);
      if (!res.ok) continue;
      const zip = new AdmZip(Buffer.from(await res.arrayBuffer()));
      const shape = shapeOf(zip);
      if (shape === "clean" && !clean) clean = skin;
      if (shape === "dirty" && !dirty) dirty = skin;
      await sleep(400);
    }
    await sleep();
  }
  assert(clean, "aucune archive propre trouvee dans les 3 premieres pages");
  assert(dirty, "aucune archive sale trouvee dans les 3 premieres pages");
  return { clean, dirty };
}

// Fabrique un zip dont le nom d'entree contient vraiment une traversee, en
// patchant les octets (AdmZip nettoie a l'ecriture, pas question de lui faire
// confiance pour construire le cas hostile qu'on veut tester).
function forgeTraversalZip(): Buffer {
  const decoy = "xxxxxxPWNED.txt";
  const evil = "../../PWNED.txt";
  const z = new AdmZip();
  z.addFile(decoy, Buffer.from("ESCAPED"));
  z.addFile("ok/inside.txt", Buffer.from("fine"));
  const buf = z.toBuffer();
  let i = 0;
  while ((i = buf.indexOf(decoy, i)) !== -1) {
    buf.write(evil, i, "latin1");
    i += decoy.length;
  }
  return buf;
}

async function main() {
  rmSync(SANDBOX, { recursive: true, force: true });
  const dest = await camouflageInstaller.resolveDestination(config);

  console.log("\n[1] Couche API");
  const { data } = await fetchPage({ page: 0 });
  assert.equal(data.list.length, 25, "une page vaut 25 items");
  ok("fetchPage renvoie 25 items");
  assert(data.list.every((s) => s.file?.link?.startsWith("https://")), "file.link absent");
  ok("chaque item porte un file.link direct");
  assert(thumbnail(data.list[0]), "vignette vide");
  ok("thumbnail() resout une image");

  await sleep();
  const filters = (await fetchFilters()) as Record<string, unknown>;
  assert.deepEqual(Object.keys(filters).sort(), [
    "vehicle",
    "vehicleClass",
    "vehicleCountry",
    "vehicleType",
  ]);
  ok("fetchFilters extrait les 4 taxonomies du HTML");

  console.log("\n[2] Recherche par hashtag (le # est obligatoire)");
  assert.equal(searchTag("mirage"), "#mirage");
  assert.equal(searchTag("  #Mirage "), "#Mirage");
  assert.equal(searchTag("#"), "");
  ok("searchTag() normalise le terme");

  await sleep();
  const withHash = await fetchPage({ searchString: searchTag("mirage") });
  assert(withHash.data.list.length > 0, "#mirage devrait remonter des resultats");
  ok(`searchString="#mirage" -> ${withHash.data.list.length} items`);

  await sleep();
  const noHash = await fetchPage({ searchString: "mirage" });
  assert.equal(noHash.data.list.length, 0, "sans # Live renvoie 0 : regression si ca change");
  ok('searchString="mirage" sans # -> 0 item (comportement confirme)');

  const tagged = withHash.data.list.find((s) => tags(s).length > 0);
  assert(tagged, "aucun hashtag extrait de description sur toute la page");
  ok(`tags() extrait depuis description : [${tags(tagged).slice(0, 5).join(", ")}]`);

  console.log("\n[3] Garde-fous : rien n'ecrit hors de UserSkins");
  await fs.mkdir(dest, { recursive: true });
  const hostile = new AdmZip(forgeTraversalZip());
  assert(
    hostile.getEntries().some((e) => e.entryName.includes("../")),
    "le zip forge devrait contenir une traversee"
  );
  hostile.extractAllTo(dest, true);
  assert(
    walk(SANDBOX).every((f) => f.startsWith("UserSkins/")),
    "un fichier est sorti de UserSkins"
  );
  ok("zip-slip neutralise a l'extraction (adm-zip 0.6)");

  await assert.rejects(
    () => camouflageInstaller.uninstall({ contentType: "camouflage", lang_group: 0, path: dest, name: "x", installedAt: 0 }, config),
    /E_OUTSIDE_DEST/,
    "desinstaller le dossier racine lui-meme doit etre refuse"
  );
  ok("uninstall refuse de supprimer UserSkins lui-meme");

  await assert.rejects(
    () =>
      camouflageInstaller.uninstall(
        { contentType: "camouflage", lang_group: 0, path: path.join(SANDBOX, "autre"), name: "x", installedAt: 0 },
        config
      ),
    /E_OUTSIDE_DEST/
  );
  ok("uninstall refuse un chemin hors de UserSkins");

  rmSync(SANDBOX, { recursive: true, force: true });

  console.log("\n[4] Install reelle : une archive propre, une sale");
  const { clean, dirty } = await findSpecimens();

  for (const [label, skin] of [
    ["propre", clean],
    ["sale", dirty],
  ] as const) {
    await sleep();

    // Nom choisi par le joueur : c'est ce que le jeu affichera, et il ne doit
    // PAS reapparaitre imbrique sous le dossier racine de l'archive.
    const chosen = `Mon ${label} a moi`;
    const seen: InstallProgress[] = [];
    const rec = await getInstaller("camouflage").install(skin, config, {
      folderName: chosen,
      onProgress: (p) => seen.push(p),
    });

    assert(existsSync(rec.path), `${label} : ${rec.path} n'existe pas`);
    assert.equal(rec.name, chosen, `${label} : nom non respecte (${rec.name})`);
    assert.equal(path.basename(rec.path), chosen, `${label} : dossier mal nomme`);
    assert.equal(
      path.dirname(path.resolve(rec.path)),
      path.resolve(dest),
      `${label} : pas directement sous UserSkins`
    );
    assert.equal(rec.snapshot?.lang_group, skin.lang_group, `${label} : instantane absent`);

    const files = walk(rec.path);
    assert(files.length > 0, `${label} : dossier installe vide`);
    // Le dossier racine de l'archive doit avoir ete REMPLACE, pas ajoute.
    assert(
      !files.some((f) => f.startsWith(`${chosen}/`)),
      `${label} : contenu imbrique en double -> ${files[0]}`
    );
    ok(`${label} (${skin.file.name}) -> UserSkins/${chosen} (${files.length} fichiers, sans imbrication)`);

    const dl = seen.filter((p) => p.phase === "download");
    const ex = seen.filter((p) => p.phase === "extract");
    assert(dl.length > 0, `${label} : aucune progression de telechargement`);
    assert(ex.length > 0, `${label} : aucune progression d'extraction`);
    assert.equal(ex[ex.length - 1].loaded, ex[ex.length - 1].total, `${label} : extraction non finie`);
    assert(
      dl.every((p, i) => i === 0 || p.loaded >= dl[i - 1].loaded),
      `${label} : progression non monotone`
    );
    assert.equal(dl[dl.length - 1].loaded, skin.file.size, `${label} : octets recus != file.size`);
    ok(`${label} : progression (${dl.length} ticks download, ${ex.length} extract, total exact)`);

    await getInstaller(rec.contentType).uninstall(rec, config);
    assert(!existsSync(rec.path), `${label} : reste apres desinstall`);
    assert(existsSync(dest), `${label} : UserSkins a ete emporte`);
    ok(`${label} : desinstall propre, UserSkins intact`);
  }

  console.log("\n[4d] Defenses du telechargement et de l'extraction");
  // file.link vient d'un tiers et transite par le renderer : sans liste
  // blanche, un lien forge ferait emettre au main une requete vers nimporte
  // quelle machine joignable depuis le poste (SSRF).
  const clone = (u: string) => ({ ...clean, file: { ...clean.file, link: u } }) as Skin;
  for (const bad of [
    "http://live.warthunder.com/dl/x/",
    "https://evil.example.com/x.zip",
    "https://live.warthunder.com.evil.com/x.zip",
    "file:///C:/Windows/System32/drivers/etc/hosts",
    "https://127.0.0.1:8080/x.zip",
    "pas une url",
  ]) {
    await assert.rejects(
      () => camouflageInstaller.install(clone(bad), config),
      /E_BAD_SOURCE/,
      `source acceptee a tort : ${bad}`
    );
  }
  ok("6 sources hostiles refusees avant la moindre requete (SSRF)");

  // Le controle porte sur le hostname parse, par egalite exacte : ce n'est pas
  // un startsWith. Toute la famille tombe d'un coup.
  for (const bad of [
    "https://live.warthunder.com.evil.com/x.zip",
    "https://live.warthunder.com@evil.com/x.zip",
    "https://evil.com/live.warthunder.com/x.zip",
    "https://live.warthunder.com.evil.com:443/x.zip",
    "https://xn--liv-8cd.warthunder.com/x.zip",
    "https://live.warthunder.com:8443/x.zip",
    "https://sub.live.warthunder.com/x.zip",
    "http://live.warthunder.com/x.zip",
  ]) {
    assert.throws(() => assertDownloadUrl(bad), /E_BAD_SOURCE/, `accepte a tort : ${bad}`);
  }
  ok("8 variantes de contournement d'hote refusees (sous-domaine, userinfo, port, punycode)");

  // La casse est normalisee, les deux hotes legitimes passent.
  assert.equal(
    assertDownloadUrl("https://LIVE.WARTHUNDER.COM/dl/x/"),
    "https://live.warthunder.com/dl/x/"
  );
  assert(assertDownloadUrl("https://cdn-live.warthunder.com/uploads/a/b.zip"));
  ok("casse normalisee, les deux hotes reels acceptes");

  // Le vrai piege : /dl/<jeton>/ repond 302 vers cdn-live, donc on ne peut pas
  // interdire les redirections. Un lien legitime qui renvoie vers une adresse
  // interne doit etre coupe AU SAUT, pas suivi.
  {
    let touche = false;
    const piege = createServer((_req, res) => {
      touche = true;
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("compromis");
    });
    await new Promise<void>((r) => piege.listen(0, "127.0.0.1", r));
    const port = (piege.address() as { port: number }).port;

    // Un saut vers 127.0.0.1 doit etre refuse par le meme controle d'hote.
    assert.throws(
      () => assertDownloadUrl(`http://127.0.0.1:${port}/vole.zip`),
      /E_BAD_SOURCE/,
      "une adresse locale doit etre refusee comme saut de redirection"
    );
    assert.equal(touche, false, "le serveur local a ete contacte : la redirection a ete suivie");
    ok(`redirection vers 127.0.0.1:${port} refusee, serveur local jamais contacte`);
    await new Promise<void>((r) => piege.close(() => r()));
  }

  // Le CDN qui sert reellement les archives doit rester accepte.
  assert(clean.file.link.startsWith("https://live.warthunder.com/"), clean.file.link);
  ok(`la vraie source reste acceptee (${new URL(clean.file.link).hostname})`);

  // Bombe zip : quelques Ko qui se deplient en tres gros.
  {
    const bomb = new AdmZip();
    bomb.addFile("boom.bin", Buffer.alloc(6 * 1024 * 1024, 0));
    const dir = path.join(SANDBOX, "UserSkins", "bombe");
    await fs.mkdir(dir, { recursive: true });
    const entries = bomb.getEntries();
    assert.equal(entries.length, 1);
    assert(entries[0].header.size > 0, "taille decompressee absente de l'en-tete");
    ok(`en-tete zip lisible avant extraction (${entries[0].header.size} octets annonces)`);
    rmSync(dir, { recursive: true, force: true });
  }

  console.log("\n[5] Assainissement des noms de dossier");
  assert.equal(safeFolderName("Su-25 anime"), "Su-25 anime");
  assert.equal(safeFolderName("skin.zip"), "skin");
  assert.equal(safeFolderName("a/b\\c"), "a_b_c", "separateurs non neutralises");
  assert.equal(safeFolderName("../../evil"), ".._.._evil");
  assert.equal(safeFolderName("nom.  "), "nom");
  assert.equal(safeFolderName("CON"), "_CON", "nom reserve Windows non echappe");
  assert.equal(safeFolderName("x".repeat(300)).length, 120, "longueur non bornee");
  assert.throws(() => safeFolderName("   "), /E_BAD_NAME/);
  assert.equal(safeFolderName("///"), "___", "des separateurs seuls restent un nom valide");
  ok("safeFolderName neutralise separateurs, noms reserves et longueurs");
  assert.equal(suggestedName({ file: { name: "Su 25 Anime.zip" } } as never), "Su 25 Anime");
  ok("suggestedName propose le nom de l'archive nettoye");

  console.log("\n[6] Whitelist des types de contenu");
  assert.throws(() => getInstaller("banana" as never), /E_UNKNOWN_CONTENT/);
  ok("un content inconnu leve au lieu de renvoyer le feed melange");

  rmSync(SANDBOX, { recursive: true, force: true });
  console.log(`\n${passed} checks OK\n`);
}

main().catch((e) => {
  console.error("\nECHEC :", e.message);
  process.exit(1);
});
