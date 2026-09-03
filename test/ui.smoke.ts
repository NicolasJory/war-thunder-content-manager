/**
 * Logique pure du renderer : options de filtre, texte de description, images
 * haute résolution, whitelist de tri. `npm run smoke:ui`.
 *
 * Tourne sans DOM ni React — c'est pour ça que ces fonctions vivent dans
 * api.ts et pas dans les composants.
 */

import assert from "assert";
import { readFileSync } from "fs";
import {
  buildOptions,
  cleanName,
  descriptionParts,
  hashtagOf,
  hiRes,
  liveUrl,
  plainText,
  visible,
  type FilterVariant,
} from "../src/renderer/src/api.js";
import { fetchFilters, fetchPage } from "../src/main/wtLive.js";
import { ERR, INVALID, splitError } from "../src/shared/errors.js";
import { DICTS, LANGS, interpolate, translator, type Key } from "../src/renderer/src/i18n.js";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

async function main() {
  console.log("\n[1] Cascade des filtres");
  const av: FilterVariant = { value: "spitfire", name: "Spitfire", dep: { vehicleType: ["aircraft"] } };
  assert(visible(av, {}), "sans selection, rien ne doit etre masque");
  assert(visible(av, { vehicleType: "aircraft" }));
  assert(!visible(av, { vehicleType: "tank" }));
  ok("une dep ne contraint que si la clé est réellement sélectionnée");

  console.log("\n[2] Options : tri, dédoublonnage, cascade");
  const variants: FilterVariant[] = [
    { value: "any", name: "Any" },
    { separator: true, name: "Great Britain" },
    { value: "uk_mark_v", name: "Mark V" },
    { value: "uk_mark_v_event", name: "Mark V" },
    { value: "uk_m1a1", name: "M1A1" },
    { separator: true, name: "USA" },
    { value: "us_m1a1", name: "M1A1" },
    { value: "us_zebra", name: "Zebra" },
    { value: "us_alpha", name: "Alpha" },
    { value: "heli_only", name: "Rooivalk", dep: { vehicleType: ["helicopter"] } },
  ];

  const all = buildOptions(variants, {});
  assert(!all.some((o) => o.value === "any"), '"any" ne doit pas etre une option');
  ok('"Any" est écarté (le champ vide veut déjà dire « tous »)');

  // 7 = les 6 nommes + Rooivalk, dont la dep ne contraint pas tant que
  // vehicleType n'est pas choisi.
  assert.equal(all.length, 7, `attendu 7 options, recu ${all.length}`);
  assert(all.every((o) => o.group), "chaque option doit porter son groupe");
  ok("toutes les options portent leur groupe, aucune n'est perdue");

  const order = all.map((o) => `${o.group}/${o.display}`);
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a.localeCompare(b, "fr", { numeric: true })),
    `ordre inattendu : ${order.join(" | ")}`
  );
  ok("tri par groupe, puis alphabétique à l'intérieur");

  const gb = all.filter((o) => o.group === "Great Britain").map((o) => o.display);
  const usa = all.filter((o) => o.group === "USA").map((o) => o.display);
  assert.deepEqual(usa, ["Alpha", "M1A1", "Rooivalk", "Zebra"], usa.join(","));
  ok(`groupe USA intact et trié : ${usa.join(", ")}`);

  // Le meme nom dans deux groupes differents n'a pas besoin d'etre suffixe :
  // l'en-tete de groupe le distingue deja a l'ecran.
  assert(all.some((o) => o.display === "M1A1" && o.value === "uk_m1a1"));
  assert(all.some((o) => o.display === "M1A1" && o.value === "us_m1a1"));
  ok("un nom présent dans deux groupes reste tel quel (l'en-tête suffit)");

  // En revanche deux fois le meme nom DANS un groupe resterait indistinguable.
  const marks = gb.filter((d) => d.startsWith("Mark V"));
  assert.equal(marks.length, 2, marks.join(","));
  assert.equal(new Set(marks).size, 2, `doublon non leve : ${marks.join(" / ")}`);
  assert(marks.some((d) => d.includes("(uk_mark_v_event)")), marks.join(" / "));
  ok(`doublon dans un même groupe : suffixé par la valeur (${marks.join(" / ")})`);

  const helis = buildOptions(variants, { vehicleType: "helicopter" });
  assert(helis.some((o) => o.value === "heli_only"), "la cascade a masque un element valide");
  assert(!buildOptions(variants, { vehicleType: "tank" }).some((o) => o.value === "heli_only"));
  ok("la cascade filtre bien les options");

  console.log("\n[2b] Marqueurs de vehicule");
  // U+2584 et consorts sont du vrai Unicode : ils portent l'information
  // (M44 marque recouvre uk_m44 / fr_m44 / it_m44), on les garde.
  assert.equal(cleanName("▄M44"), "▄M44");
  assert.equal(cleanName("◘AH-64D"), "◘AH-64D");
  assert.equal(cleanName("␗A6M2"), "␗A6M2");
  ok("les marqueurs Unicode sont conserves");
  assert.equal(cleanName("A-4E Early (M)"), "A-4E Early (M)");
  assert.equal(cleanName("X"), "X");
  ok("la zone privee (U+E000-U+F8FF) est retiree");
  assert.equal(cleanName("  A  B  "), "A B");
  ok("espaces normalises");
  {
    const tax0 = (await fetchFilters()) as Record<string, { variants: FilterVariant[] }>;
    const opts0 = buildOptions(tax0.vehicle.variants, {});
    const pua = opts0.filter((o) =>
      [...o.display].some((c) => {
        const cp = c.codePointAt(0)!;
        return cp >= 0xe000 && cp <= 0xf8ff;
      })
    );
    assert.equal(pua.length, 0, `${pua.length} libelles gardent un caractere non dessinable`);
    const kept = opts0.filter((o) => o.display.startsWith("▄"));
    assert(kept.length > 0, "les marqueurs ont disparu, ils devaient rester");
    ok(`taxonomie reelle : 0 caractere non dessinable, ${kept.length} marqueurs conserves`);
  }

  console.log("\n[3] Description : du HTML distant vers du texte sûr");
  const html =
    '<p>Ligne 1<br />Ligne 2</p><p>Tom &amp; Jerry &lt;3 &#233;t&eacute;</p>' +
    '<a href="//live.warthunder.com/?q=%23anime" class="WTL-Embed-Hashtag">#anime</a>';
  const txt = plainText(html);
  assert(!/[<>]/.test(txt.replace("<3", "")), `des chevrons subsistent : ${txt}`);
  ok("aucune balise ne survit");
  assert(txt.includes("Tom & Jerry"), txt);
  assert(txt.includes("<3"), txt);
  assert(txt.includes("été"), txt);
  ok("entités décodées (&amp;, &lt;, &#233;, &eacute;)");
  assert(txt.includes("Ligne 1\nLigne 2"), JSON.stringify(txt));
  ok("les sauts de ligne sont préservés");
  assert(!plainText('<img src=x onerror="alert(1)">').includes("onerror"), "attribut conserve");
  ok("un attribut d'événement injecté ne ressort pas");
  assert.equal(plainText(""), "");
  assert.equal(plainText(undefined as unknown as string), "");
  ok("une description vide ou absente ne lève pas");

  console.log("\n[3b] Liens de description");
  {
    const mk = (d: string) => ({ description: d }) as never;
    const A = (h: string, t: string) => `<a href="${h}">${t}</a>`;

    // Les hashtags disparaissent du texte : ils sont deja rendus en pastilles.
    const tagged = descriptionParts(
      mk('<p>Salut</p><a class="WTL-Embed-Hashtag" href="/?q=%23x">#winter</a>')
    );
    assert(!tagged.some((p) => p.text.includes("winter")), JSON.stringify(tagged));
    ok("les hashtags sont retires du texte, pas affiches deux fois");

    // Une ancre garde sa destination.
    const linked = descriptionParts(mk("<p>Voir " + A("https://example.com/a", "ici") + "</p>"));
    const link = linked.find((p) => p.href);
    assert(link, JSON.stringify(linked));
    assert.equal(link.text, "ici");
    assert.equal(link.href, "https://example.com/a");
    ok("une ancre devient un segment cliquable qui garde son texte");

    // Une URL ecrite en clair devient cliquable aussi.
    const bare = descriptionParts(mk("<p>Depot : https://github.com/x/y merci</p>"));
    const b = bare.find((p) => p.href);
    assert(b, JSON.stringify(bare));
    assert.equal(b.href, "https://github.com/x/y");
    assert(bare.some((p) => !p.href && p.text.includes("merci")), "le texte autour est perdu");
    ok("une URL en clair devient cliquable, le texte autour est conserve");

    // Les schemas dangereux ne doivent PAS ressembler a un lien.
    for (const bad of ["javascript:alert(1)", "file:///C:/Windows", "data:text/html,x"]) {
      const parts = descriptionParts(mk("<p>" + A(bad, "clique") + "</p>"));
      const seg = parts.find((p) => p.text === "clique");
      assert(seg, JSON.stringify(parts));
      assert.equal(seg.href, undefined, `${bad} rendu comme lien cliquable`);
    }
    ok("javascript:, file: et data: ne sont pas rendus cliquables");

    // Aucun HTML ne survit dans le texte affiche.
    const raw = descriptionParts(mk('<p>a<img src=x onerror="alert(1)">b</p>'));
    assert(!raw.some((p) => /[<>]/.test(p.text) || p.text.includes("onerror")), JSON.stringify(raw));
    ok("aucune balise ni attribut d'evenement ne subsiste");

    // Un hashtag ne doit JAMAIS sortir vers le site : il relance la recherche
    // dans l'app. Deux formes existent dans les descriptions de Live.
    assert.equal(hashtagOf("//live.warthunder.com/?q=%23winter"), "winter");
    assert.equal(hashtagOf("https://live.warthunder.com/?q=%23Tiger"), "tiger");
    assert.equal(hashtagOf("https://live.warthunder.com/feed/all/"), undefined);
    assert.equal(hashtagOf("https://evil.com/?q=%23winter"), undefined, "hote non verifie");
    ok("hashtagOf reconnait une recherche Live et rejette les autres hotes");

    const withTag = descriptionParts(mk("<p>Voir " + A("//live.warthunder.com/?q=%23winter", "#winter") + "</p>"));
    const seg = withTag.find((p) => p.tag);
    assert(seg, JSON.stringify(withTag));
    assert.equal(seg.tag, "winter");
    assert.equal(seg.href, undefined, "un hashtag ne doit pas etre un lien externe");
    ok("un lien de hashtag devient une recherche interne, pas une sortie");

    const plain = descriptionParts(mk("<p>Skin #winter pour le #tigerII</p>"));
    const tags2 = plain.filter((p) => p.tag).map((p) => p.tag);
    assert.deepEqual(tags2, ["winter", "tigerii"], JSON.stringify(plain));
    ok("les #hashtags ecrits en clair deviennent cliquables");

    // Une URL contenant un # d'ancre ne doit pas etre coupee en hashtag.
    const anchored = descriptionParts(mk("<p>https://ex.com/a#section fin</p>"));
    assert(anchored.some((p) => p.href === "https://ex.com/a#section"), JSON.stringify(anchored));
    assert(!anchored.some((p) => p.tag), "le # d'une URL a ete pris pour un hashtag");
    ok("le # d'une ancre d'URL n'est pas confondu avec un hashtag");

    const punct = descriptionParts(mk("<p>Voir https://ex.com/a. Et #winter, oui.</p>"));
    assert(punct.some((p) => p.href === "https://ex.com/a"), JSON.stringify(punct));
    assert(punct.some((p) => p.tag === "winter"), JSON.stringify(punct));
    assert(!punct.some((p) => (p.href ?? "").endsWith(".")), "point final capture dans l'URL");
    assert(!punct.some((p) => (p.tag ?? "").endsWith(",")), "virgule capturee dans le hashtag");
    ok("la ponctuation finale reste dans la phrase, hors du lien");
  }

  console.log("\n[4] Images haute résolution");
  const lq = "https://cdn-live.warthunder.com/uploads/ab/cd_lq/shot.png";
  assert.equal(hiRes(lq), "https://cdn-live.warthunder.com/uploads/ab/cd_mq/shot.png");
  ok("_lq devient _mq");
  const noLq = "https://cdn-live.warthunder.com/uploads/ab/cd/shot.png";
  assert.equal(hiRes(noLq), noLq, "une URL sans _lq doit rester intacte");
  ok("une URL sans _lq est laissée telle quelle");

  console.log("\n[4b] URL de la page publique");
  // /post/<id>/ menait a un TOUT AUTRE contenu : l'identifiant de page est
  // lang_group, pas id. Verifie en direct : /post/249822/ (id) -> "Image by
  // antonioll", /post/240523/ (lang_group) -> le bon camouflage.
  const fake = { id: 249822, lang_group: 240523 } as never;
  assert.equal(liveUrl(fake), "https://live.warthunder.com/post/240523/");
  assert(!liveUrl(fake).includes("249822"), "liveUrl utilise encore skin.id");
  ok("liveUrl s'appuie sur lang_group, pas sur id");

  console.log("\n[4c] Traduction des erreurs du main");
  // Le main n'emet que des codes : chacun doit avoir un texte dans CHAQUE langue,
  // sinon un utilisateur verrait un code brut a l'ecran.
  const codes = [...Object.values(ERR), ...Object.values(INVALID)];
  for (const lang of LANGS) {
    const tr = translator(lang.code);
    const manquants = codes.filter((c) => tr(c as Key) === c);
    assert.equal(manquants.length, 0, `${lang.code} : sans traduction -> ${manquants.join(", ")}`);
  }
  ok(`${codes.length} codes d'erreur traduits dans ${LANGS.length} langues`);

  // Le detail (statut HTTP, chemin) suit le code et n'est jamais traduit.
  const parsed = splitError("E_DOWNLOAD: 404");
  assert.equal(parsed.code, "E_DOWNLOAD");
  assert.equal(parsed.detail, "404");
  assert.deepEqual(splitError("E_EMPTY_ARCHIVE"), { code: "E_EMPTY_ARCHIVE", detail: "" });
  ok("splitError separe le code du detail");

  // Electron enrobe tout ce qui traverse invoke, et le nom du canal contient
  // deja un ":". Le joueur voyait "Install failed: undefined" a chaque erreur.
  const wrapped = splitError(
    "Error invoking remote method 'content:install': Error: E_CANCELED"
  );
  assert.equal(wrapped.code, ERR.canceled, "code perdu dans l'enrobage IPC");
  const wrappedDetail = splitError(
    "Error invoking remote method 'content:install': Error: E_DOWNLOAD: 503"
  );
  assert.equal(wrappedDetail.code, ERR.download);
  assert.equal(wrappedDetail.detail, "503", "detail perdu dans l'enrobage IPC");
  ok("un code enrobe par l'IPC d'Electron reste reconnu et traduit");

  // tError passe au traducteur un code venu du main, via un cast : une cle
  // absente doit revenir telle quelle, jamais en "undefined".
  assert.equal(
    translator("en")("E_JAMAIS_VU" as Key),
    "E_JAMAIS_VU",
    "une cle inconnue rend undefined au lieu d'elle-meme"
  );
  ok("une cle inconnue revient telle quelle et non en undefined");

  // Un vrai appel doit lever un CODE, pas une phrase.
  await assert.rejects(
    () => fetchPage({ content: "banana" as never }),
    (e: Error) => splitError(e.message).code === ERR.unknownContent,
    "le main doit lever un code, pas du texte"
  );
  ok("une erreur reelle du main porte bien un code traduisible");

  console.log("\n[4e] Integrite des 4 langues");
  {
    const langs = LANGS.map((l) => l.code);
    assert.deepEqual(langs, ["en", "fr", "ru", "zh"], langs.join(","));
    const enKeys = Object.keys(DICTS.en) as Key[];

    for (const lang of langs) {
      const dict = DICTS[lang];

      // 1. Aucune cle manquante ni en trop.
      assert.deepEqual(
        Object.keys(dict).sort(),
        [...enKeys].sort(),
        `${lang} : jeu de cles different de l'anglais`
      );

      // 2. Aucune chaine vide, aucun reste de copier-coller.
      const vides = enKeys.filter((k) => !dict[k] || !dict[k].trim());
      assert.equal(vides.length, 0, `${lang} : chaines vides -> ${vides.join(", ")}`);

      // 3. Les JETONS doivent correspondre exactement. C'est le controle qui
      //    compte : une traduction qui perd un {n} affiche une phrase amputee,
      //    et personne ne s'en apercoit dans une langue qu'il ne lit pas.
      for (const k of enKeys) {
        const tok = (s: string) => [...s.matchAll(/{(\w+)}/g)].map((m) => m[1]).sort();
        assert.deepEqual(
          tok(dict[k]),
          tok(DICTS.en[k]),
          `${lang} / ${k} : jetons "${tok(dict[k]).join(",")}" != "${tok(DICTS.en[k]).join(",")}"`
        );
      }
    }
    ok(`${langs.length} langues x ${enKeys.length} cles : memes cles, memes jetons, rien de vide`);

    // 4. Les langues non latines doivent vraiment etre traduites, pas recopiees
    //    de l'anglais. On tolere les noms propres et les termes techniques.
    const exempts = new Set<string>([
      "appName", "brandTop", "brandBottom", "monogram", "hashtagPlaceholder",
      "openSkinsFolder", "downloadProgress",
    ]);
    for (const lang of ["ru", "zh"] as const) {
      const identiques = enKeys.filter(
        (k) => !exempts.has(k) && DICTS[lang][k] === DICTS.en[k]
      );
      assert.equal(identiques.length, 0, `${lang} : non traduit -> ${identiques.join(", ")}`);
    }
    ok("russe et chinois : aucune chaine laissee en anglais");

    // 5. Le russe doit etre en cyrillique, le chinois en ideogrammes.
    const aCyrillique = (s: string) => /[Ѐ-ӿ]/.test(s);
    const aHan = (s: string) => /[一-鿿]/.test(s);
    const ruSansCyr = enKeys.filter((k) => !exempts.has(k) && !aCyrillique(DICTS.ru[k]));
    const zhSansHan = enKeys.filter((k) => !exempts.has(k) && !aHan(DICTS.zh[k]));
    assert.equal(ruSansCyr.length, 0, `ru sans cyrillique -> ${ruSansCyr.join(", ")}`);
    assert.equal(zhSansHan.length, 0, `zh sans ideogramme -> ${zhSansHan.join(", ")}`);
    ok("russe entierement en cyrillique, chinois en ideogrammes");

    // 6. L'interpolation place la valeur AU BON ENDROIT selon la langue.
    assert.equal(translator("en")("page", { n: 3 }), "Page 3");
    assert.equal(translator("ru")("page", { n: 3 }), "Страница 3");
    const zhPage = translator("zh")("page", { n: 3 });
    assert(zhPage.includes("3") && zhPage.startsWith("第"), zhPage);
    assert(!zhPage.includes("{"), `jeton non remplace : ${zhPage}`);
    ok(`nombre place selon la langue (zh : "${zhPage}", pas une concatenation)`);

    // 7. Un jeton sans valeur reste visible plutot que de devenir "undefined".
    assert.equal(interpolate("Page {n}"), "Page {n}");
    assert.equal(interpolate("Page {n}", {}), "Page {n}");
    assert.equal(interpolate("{a} et {b}", { a: "x" }), "x et {b}");
    ok("un jeton sans valeur reste lisible au lieu de devenir undefined");

    // Les quatre libelles de filtre doivent venir de NOUS. `get_head` fournit un
    // `placeholder`, mais toujours en anglais : s'en servir laisserait "Country"
    // affiche en russe et en chinois.
    const filterKeys = ["filterCountry", "filterType", "filterClass", "filterVehicle"] as const;
    for (const lang of ["ru", "zh"] as const) {
      for (const k of filterKeys) {
        assert.notEqual(DICTS[lang][k], DICTS.en[k], `${lang} / ${k} laisse en anglais`);
      }
    }
    const browse = readFileSync("src/renderer/src/Browse.tsx", "utf8");
    assert(
      !/placeholder\s*\?\?\s*key/.test(browse),
      "Browse affiche encore le placeholder de l'API comme libelle de filtre"
    );
    assert(browse.includes("FILTER_LABEL[key]"), "les libelles de filtre ne passent pas par i18n");
    ok(`les 4 libelles de filtre sont traduits (zh : ${filterKeys.map((k) => DICTS.zh[k]).join(", ")})`);
  }

  console.log("\n[5] Whitelist de tri");
  await assert.rejects(() => fetchPage({ sort: "bidon" as never }), /E_UNKNOWN_SORT/);
  ok("un tri inconnu lève au lieu de retomber silencieusement sur created");

  console.log("\n[6] Contre la vraie taxonomie de Live");
  const tax = (await fetchFilters()) as Record<string, { variants: FilterVariant[] }>;
  for (const key of ["vehicleCountry", "vehicleType", "vehicleClass", "vehicle"]) {
    const opts = buildOptions(tax[key].variants, {});
    assert(opts.length > 0, `${key} : aucune option`);
    assert.equal(new Set(opts.map((o) => o.value)).size, opts.length, `${key} : valeurs dupliquees`);
    // Ce qui doit etre unique, c'est (groupe, libelle) : c'est ce que l'oeil
    // voit dans la liste sous un en-tete donne.
    const pairs = opts.map((o) => JSON.stringify([o.group, o.display]));
    assert.equal(new Set(pairs).size, pairs.length, `${key} : (groupe, libelle) duplique`);
    const groups = new Set(opts.map((o) => o.group));
    ok(`${key} : ${opts.length} options, ${groups.size} groupe(s), aucun doublon visible`);
  }

  // Le contrat demande : separations par pays SEULEMENT si aucune nation n'est
  // choisie. Une nation selectionnee ne doit laisser qu'un groupe, ce qui fait
  // disparaitre les en-tetes cote composant.
  const allVehGroups = new Set(buildOptions(tax.vehicle.variants, {}).map((o) => o.group));
  assert(allVehGroups.size > 1, "sans nation, il faut plusieurs groupes");
  const brit = buildOptions(tax.vehicle.variants, { vehicleCountry: "britain" });
  const britGroups = [...new Set(brit.map((o) => o.group))];
  assert.equal(britGroups.length, 1, `attendu 1 groupe, recu ${britGroups.join(" / ")}`);
  assert(brit.length > 0 && brit.length < 3000, `${brit.length} vehicules britanniques`);
  ok(`nation choisie -> 1 seul groupe ("${britGroups[0]}", ${brit.length} véhicules), en-têtes masqués`);

  const veh = buildOptions(tax.vehicle.variants, { vehicleType: "helicopter" });
  const allVeh = buildOptions(tax.vehicle.variants, {});
  assert(veh.length < allVeh.length, "la cascade ne reduit pas la liste des vehicules");
  ok(`cascade réelle : ${allVeh.length} véhicules -> ${veh.length} en hélicoptères`);

  console.log(`\n${passed} checks OK\n`);
}

main().catch((e) => {
  console.error("\nECHEC :", e.message);
  process.exit(1);
});
