/**
 * Validation de la frontière IPC. `npm run smoke:validate`.
 *
 * Ces fonctions sont la seule vérification réelle de ce que le renderer envoie
 * au main : TypeScript disparaît à l'exécution. Elles sont pures, donc
 * testables sans lancer Electron — c'est précisément pourquoi elles vivent
 * dans shared/ plutôt que dans les handlers.
 */

import assert from "assert";
import {
  asIndex,
  asOneOf,
  asRecordRef,
  asSearchParams,
  asSkin,
  asString,
  asUserPage,
} from "../src/shared/validate.js";
import { hasUpdate } from "../src/renderer/src/api.js";
import { appUrl, parseDeepLink, shareUrl } from "../src/shared/deepLink.js";
import { DEFAULT_ENDPOINTS, fillTemplate, mergeEndpoints } from "../src/shared/endpoints.js";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

const skinBase = {
  id: 42,
  lang_group: 4242,
  likes: 10,
  views: 20,
  downloads: 30,
  comments: 4,
  created: 1700000000,
  type: "camouflage",
  description: "<p>x</p>",
  author: { id: 7, nickname: "a", avatar: "" },
  images: [{ src: "https://x/1.png" }],
  file: { name: "s.zip", link: "https://live.warthunder.com/dl/x/", size: 100 },
};

function main() {
  console.log("\n[1] Types de base");
  assert.equal(asString("ok"), "ok");
  assert.throws(() => asString(42), /E_BAD_ARGS/);
  assert.throws(() => asString(null), /E_BAD_ARGS/);
  assert.throws(() => asString("x".repeat(5000), 4096), /E_BAD_ARGS/);
  ok("asString refuse les non-chaines et borne la longueur");

  assert.equal(asIndex(7), 7);
  assert.throws(() => asIndex(-1), /E_BAD_ARGS/);
  assert.throws(() => asIndex(1.5), /E_BAD_ARGS/);
  assert.throws(() => asIndex("7"), /E_BAD_ARGS/);
  assert.throws(() => asIndex(NaN), /E_BAD_ARGS/);
  assert.throws(() => asIndex(Infinity), /E_BAD_ARGS/);
  ok("asIndex refuse negatifs, decimaux, chaines, NaN et Infinity");

  assert.equal(asOneOf("a", ["a", "b"] as const), "a");
  assert.throws(() => asOneOf("c", ["a", "b"] as const), /E_BAD_ARGS/);
  ok("asOneOf refuse hors liste");

  console.log("\n[2] Parametres de recherche");
  const clean = asSearchParams({
    content: "camouflage",
    page: 2,
    vehicle: "su_25",
    // Champs non prevus : doivent disparaitre, pas etre transmis a Live.
    user: "admin",
    featured: "1",
    __proto__: { pollue: true },
  });
  assert.deepEqual(Object.keys(clean).sort(), ["content", "page", "vehicle"]);
  assert.equal((clean as Record<string, unknown>).user, undefined);
  ok("les champs non prevus sont jetes, pas transmis");
  assert.throws(() => asSearchParams(null), /E_BAD_ARGS/);
  assert.throws(() => asSearchParams({ page: -3 }), /E_BAD_ARGS/);
  assert.throws(() => asSearchParams({ vehicle: "x".repeat(500) }), /E_BAD_ARGS/);
  ok("objet absent, page negative et valeur trop longue sont refuses");

  console.log("\n[3] Page auteur");
  assert.deepEqual(asUserPage({ user: 5, page: 1 }), { user: 5, page: 1 });
  assert.throws(() => asUserPage({ user: "toto" }), /E_BAD_ARGS/);
  assert.throws(() => asUserPage({}), /E_BAD_ARGS/);
  ok("l'identifiant d'auteur doit etre un entier");

  console.log("\n[4] Contenu a installer");
  const s = asSkin(skinBase);
  assert.equal(s.id, 42);
  assert.equal(s.file.link, "https://live.warthunder.com/dl/x/");
  ok("un contenu valide passe intact");

  // Le coeur du sujet : ce qui est persiste dans config.json.
  const hostile = {
    ...skinBase,
    charge: "x".repeat(2_000_000),
    __proto__: { pollue: true },
    author: { ...skinBase.author, nickname: "n".repeat(9999), secret: "fuite" },
    images: Array.from({ length: 5000 }, () => ({ src: "https://x/" + "y".repeat(2000) })),
    description: "d".repeat(100_000),
  };
  const cleaned = asSkin(hostile);
  const size = JSON.stringify(cleaned).length;
  assert.equal((cleaned as unknown as Record<string, unknown>).charge, undefined, "champ arbitraire conserve");
  assert.equal((cleaned.author as unknown as Record<string, unknown>).secret, undefined, "champ auteur conserve");
  assert(cleaned.description.length <= 8000, `description de ${cleaned.description.length}`);
  assert(cleaned.author.nickname.length <= 128);
  assert(cleaned.images.length <= 12, `${cleaned.images.length} images conservees`);
  assert(size < 15_000, `instantane de ${size} octets — trop gros pour config.json`);
  ok(`un contenu hostile de 2 Mo est ramene a ${size} octets, sans champ etranger`);

  assert.throws(() => asSkin({ ...skinBase, file: {} }), /E_BAD_ARGS/);
  assert.throws(() => asSkin(null), /E_BAD_ARGS/);
  assert.throws(() => asSkin({ ...skinBase, id: -1 }), /E_BAD_ARGS/);
  ok("file.link manquant, objet absent et id invalide sont refuses");

  // Live attribue ses propres identifiants : un plafond fixe (ancien
  // 100_000_000) a fini par rejeter du contenu reel une fois franchi.
  const grownId = asSkin({ ...skinBase, id: 195_976_045, lang_group: 195_976_045 });
  assert.equal(grownId.id, 195_976_045);
  ok("un identifiant Live au-dela de 100 millions passe toujours");

  console.log("\n[5] Reference de desinstallation");
  assert.deepEqual(asRecordRef({ contentType: "camouflage", lang_group: 9, path: "C:/Windows" }), {
    contentType: "camouflage",
    lang_group: 9,
  });
  ok("le chemin transmis par le renderer est ignore, seule la reference compte");
  assert.throws(() => asRecordRef({ contentType: "camouflage" }), /E_BAD_ARGS/);
  ok("une reference incomplete est refusee");

  console.log("\n[6] Detection de republication");
  const rec = {
    contentType: "camouflage" as const,
    lang_group: 4242,
    path: "p",
    name: "n",
    installedAt: 0,
    fingerprint: "42:100:s.zip",
    snapshot: skinBase as never,
  };
  assert.equal(hasUpdate(rec), false, "un contenu inchange ne doit pas etre signale");
  assert.equal(
    hasUpdate({ ...rec, snapshot: { ...skinBase, file: { ...skinBase.file, size: 200 } } as never }),
    true,
    "une archive de taille differente doit etre signalee"
  );
  assert.equal(hasUpdate({ ...rec, fingerprint: undefined }), false, "sans empreinte, pas de faux positif");
  assert.equal(hasUpdate({ ...rec, snapshot: undefined }), false);
  ok("republication detectee sur l'empreinte, sans faux positif quand elle manque");

  console.log("\n[7] Liens entrants");
  assert.deepEqual(parseDeepLink("https://live.warthunder.com/post/240523/"), { kind: "post", langGroup: 240523 });
  assert.deepEqual(parseDeepLink("https://live.warthunder.com/post/240523/en/"), { kind: "post", langGroup: 240523 });
  assert.deepEqual(parseDeepLink("wtcm://post/240523"), { kind: "post", langGroup: 240523 });
  assert.deepEqual(parseDeepLink("wtcm://https://live.warthunder.com/post/240523/"), { kind: "post", langGroup: 240523 });
  ok("un contenu se reconnait en URL Live, en lien court et en lien encapsule");

  assert.deepEqual(parseDeepLink("https://live.warthunder.com/user/Kriegsmaler/"), { kind: "author", nickname: "Kriegsmaler" });
  assert.deepEqual(parseDeepLink("https://live.warthunder.com/?q=%23winter"), { kind: "tag", tag: "winter" });
  assert.deepEqual(parseDeepLink("wtcm://tag/%23Winter"), { kind: "tag", tag: "winter" });
  ok("auteur et hashtag sont reconnus, le tag est normalise");

  // Tout le reste ne doit RIEN declencher : un lien entrant vient de l'exterieur.
  for (const bad of [
    "", "   ", "pas une url",
    "https://evil.com/post/240523/",
    "https://live.warthunder.com.evil.com/post/1/",
    "file:///C:/Windows/System32",
    "javascript:alert(1)",
    "wtcm://post/abc",
    "wtcm://post/-1",
    "wtcm://post/999999999999",
    "wtcm://inconnu/x",
    "https://live.warthunder.com/",
  ]) {
    assert.equal(parseDeepLink(bad), null, `accepte a tort : ${JSON.stringify(bad)}`);
  }
  ok("12 entrees hostiles ou vides ne declenchent rien");

  assert.equal(shareUrl(240523), "https://live.warthunder.com/post/240523/");
  assert.equal(appUrl(240523), "wtcm://post/240523");
  assert.deepEqual(parseDeepLink(shareUrl(4242)), { kind: "post", langGroup: 4242 });
  assert.deepEqual(parseDeepLink(appUrl(4242)), { kind: "post", langGroup: 4242 });
  ok("les liens produits par l'app se relisent eux-memes");

  console.log("\n[8] Manifeste des adresses");
  {
    // Aucun remplacement : les valeurs par defaut passent intactes.
    assert.deepEqual(mergeEndpoints(null), DEFAULT_ENDPOINTS);
    assert.deepEqual(mergeEndpoints("pas un objet"), DEFAULT_ENDPOINTS);
    ok("un remplacement absent ou invalide garde les valeurs par defaut");

    // Le cas d'usage : Live demenage, on repare sans recompiler.
    const moved = mergeEndpoints({
      base: "https://live2.warthunder.com",
      api: { feed: "/api/v2/feed/" },
      downloadHosts: ["cdn2.warthunder.com"],
      pages: { post: "https://live2.warthunder.com/p/{id}" },
    });
    assert.equal(moved.base, "https://live2.warthunder.com");
    assert.equal(moved.api.feed, "/api/v2/feed/");
    assert.deepEqual(moved.downloadHosts, ["cdn2.warthunder.com"]);
    assert.equal(moved.pages.post, "https://live2.warthunder.com/p/{id}");
    // Les champs non fournis ne bougent pas.
    assert.equal(moved.api.post, DEFAULT_ENDPOINTS.api.post);
    assert.deepEqual(moved.limits, DEFAULT_ENDPOINTS.limits);
    ok("un remplacement partiel change ce qu'il declare et rien d'autre");

    // Un fichier a moitie faux ne doit pas emporter les champs valides.
    const mixed = mergeEndpoints({
      base: "http://insecure.example.com",
      api: { feed: "sans-slash", head: "/api/ok/" },
      downloadHosts: ["pas un hote", "evil"],
      filtersPattern: "([",
      pages: { post: "javascript:alert(1)" },
      limits: { maxEntries: -5, idleMs: 1234 },
    });
    assert.equal(mixed.base, DEFAULT_ENDPOINTS.base, "base non https acceptee");
    assert.equal(mixed.api.feed, DEFAULT_ENDPOINTS.api.feed, "chemin sans slash accepte");
    assert.equal(mixed.api.head, "/api/ok/", "champ valide rejete avec les autres");
    assert.deepEqual(mixed.downloadHosts, DEFAULT_ENDPOINTS.downloadHosts, "hotes invalides acceptes");
    assert.equal(mixed.filtersPattern, DEFAULT_ENDPOINTS.filtersPattern, "motif invalide accepte");
    assert.equal(mixed.pages.post, DEFAULT_ENDPOINTS.pages.post, "javascript: accepte");
    assert.equal(mixed.limits.maxEntries, DEFAULT_ENDPOINTS.limits.maxEntries, "limite negative acceptee");
    assert.equal(mixed.limits.idleMs, 1234, "limite valide rejetee");
    ok("chaque champ est valide separement : le valide passe, le reste retombe");

    // Les gabarits encodent leurs valeurs : elles viennent de l'API.
    assert.equal(fillTemplate("https://x/post/{id}/", { id: 42 }), "https://x/post/42/");
    assert.equal(fillTemplate("https://x/u/{name}/", { name: "a b/c" }), "https://x/u/a%20b%2Fc/");
    assert.equal(fillTemplate("https://x/{absent}", {}), "https://x/{absent}");
    ok("fillTemplate encode les valeurs et laisse visible un jeton sans valeur");

    // Le manifeste par defaut doit rester coherent avec lui-meme.
    for (const p of Object.values(DEFAULT_ENDPOINTS.api)) {
      assert(p.startsWith("/"), `chemin d'API sans slash : ${p}`);
    }
    assert(new URL(DEFAULT_ENDPOINTS.base).protocol === "https:");
    assert(DEFAULT_ENDPOINTS.downloadHosts.length > 0);
    new RegExp(DEFAULT_ENDPOINTS.filtersPattern);
    assert.deepEqual(parseDeepLink(shareUrl(4242)), { kind: "post", langGroup: 4242 });
    ok("le manifeste par defaut est coherent et ses liens se relisent");
  }

  console.log(`\n${passed} checks OK\n`);
}

try {
  main();
} catch (e) {
  console.error("\nECHEC :", (e as Error).message);
  process.exit(1);
}
