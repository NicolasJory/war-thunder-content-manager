/**
 * wtLive.ts — Cœur d'un gestionnaire de contenu War Thunder Live.
 * À exécuter dans le MAIN PROCESS d'Electron (jamais dans le renderer/navigateur) :
 *   - l'API de Live vérifie l'header Origin, donc un fetch browser se ferait jeter (CORS + refus)
 *   - l'installation touche au filesystem (dézip + déplacement de dossiers, patch de config…)
 *
 * Architecture extensible : une couche API commune paramétrée par `content`
 * (camouflage / sight / sound / …) + une interface `Installer` enfichable, une
 * implémentation par type de contenu. SEUL le camouflage est livré ici ; les
 * viseurs et mods son sont décrits dans le brief comme extensions à brancher.
 *
 * Les endpoints ne sont pas officiels : ils ont été relevés en observant le
 * trafic du site, et peuvent casser si Gaijin le fait évoluer. Toute la surface
 * externe est déclarée dans shared/endpoints.ts, précisément pour que ce jour-là
 * la réparation soit une donnée à changer, pas du code.
 *
 * Dépendance zip :  npm i adm-zip   (+  npm i -D @types/adm-zip)
 * adm-zip >= 0.6.0 requis : sa protection zip-slip à l'extraction est vérifiée
 * par test/install.smoke.ts. Ne pas downgrader.
 */

import AdmZip from "adm-zip";
import { promises as fs } from "fs";
import path from "path";
import { ERR, fail } from "../shared/errors.js";
import { DEFAULT_ENDPOINTS, type Endpoints } from "../shared/endpoints.js";
import { planSightLayout } from "./sightLayout.js";
import { homedir } from "os";

/**
 * Manifeste courant. Toute la surface externe passe par lui : aucune URL, aucun
 * en-tête et aucune limite n'est écrite en dur dans ce fichier.
 *
 * Il est remplaçable au démarrage — voir `setEndpoints` — ce qui permet de
 * réparer un changement d'API sans recompiler.
 */
let ENDPOINTS: Endpoints = DEFAULT_ENDPOINTS;

export function setEndpoints(next: Endpoints): void {
  ENDPOINTS = next;
}

export function endpoints(): Endpoints {
  return ENDPOINTS;
}

const url = (path: string) => `${ENDPOINTS.base}${path}`;

/**
 * Appel d'API avec délai d'attente et réessais.
 *
 * Les appels sortants n'avaient ni l'un ni l'autre : un serveur qui ne répond
 * jamais bloquait l'interface sans fin, et un incident passager remontait une
 * erreur au joueur alors qu'un second essai aurait suffi.
 *
 * On ne réessaie que ce qui a une chance d'aboutir : une coupure réseau, une
 * erreur serveur, une limitation de débit. Un 404 ou un 400 ne changera pas
 * d'avis, insister ne ferait que retarder le message d'erreur.
 *
 * Deux réessais au maximum, avec une attente qui double. L'API n'est pas
 * officielle : on ne la martèle pas.
 */
async function apiFetch(target: string, init: RequestInit = {}): Promise<Response> {
  const { apiTimeoutMs, retries, retryBaseMs } = ENDPOINTS.limits;
  let last: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Une part d'aléa dans l'attente : si plusieurs appels échouent
      // ensemble, ils ne repartent pas tous à la même milliseconde.
      const wait = retryBaseMs * 2 ** (attempt - 1) * (0.75 + Math.random() * 0.5);
      await new Promise((r) => setTimeout(r, wait));
    }

    try {
      const res = await fetch(target, { ...init, signal: AbortSignal.timeout(apiTimeoutMs) });
      // 429 et 5xx méritent un second essai ; le reste est définitif.
      if ((res.status === 429 || res.status >= 500) && attempt < retries) {
        last = new Error(`HTTP ${res.status}`);
        continue;
      }
      return res;
    } catch (e) {
      last = e;
    }
  }

  throw last instanceof Error ? last : new Error("network");
}

// ------------------------- Types de contenu ------------------------- //
// Tous vérifiés en sniffant : chaque valeur renvoie bien des items de son `type`.
// Live expose aussi un type `mission`, non installable, hors périmètre.
export type ContentType =
  | "camouflage"
  | "sight"
  | "sound"
  | "location"
  | "model"
  | "controls";

// get_regular ne valide PAS `content` : une valeur inconnue répond 200 avec le
// feed tous-types mélangé, silencieusement. D'où la whitelist.
const CONTENT_TYPES: readonly ContentType[] = [
  "camouflage",
  "sight",
  "sound",
  "location",
  "model",
  "controls",
];

function assertContentType(c: string): ContentType {
  if (!(CONTENT_TYPES as readonly string[]).includes(c)) {
    fail(ERR.unknownContent, c);
  }
  return c as ContentType;
}

// ------------------------- Tri ------------------------- //
// Les 4 options du menu de tri de Live, relevées sur /feed/camouflages/ :
//   created "Recent" · rating "Popular" · comments "Most commented" · downloads "Most downloaded"
// Comme pour `content`, une valeur inconnue ne lève pas : elle retombe
// silencieusement sur created. D'où la whitelist.
export type SortKey = "created" | "rating" | "comments" | "downloads";

const SORT_KEYS: readonly SortKey[] = ["created", "rating", "comments", "downloads"];

function assertSort(s: string): SortKey {
  if (!(SORT_KEYS as readonly string[]).includes(s)) {
    fail(ERR.unknownSort, s);
  }
  return s as SortKey;
}

// ------------------------- Types de réponse ------------------------- //

export interface Skin {
  id: number;
  lang_group: number;
  likes: number;
  views: number;
  downloads: number;
  comments: number;
  created: number;
  type: string; // camouflage | sight | sound | image | video … — voir fetchUserPage
  description: string; // HTML brut — à échapper avant affichage
  author: { id: number; nickname: string; avatar: string };
  images: Array<{ src?: string; orig?: { src: string } }>;
  file: { name: string; link: string; size: number }; // file.link = URL directe de l'archive
}

export interface Page {
  data: { list: Skin[]; pageTitle: string };
}

export interface SearchParams {
  content?: ContentType; // défaut: "camouflage"
  sort?: SortKey; // défaut: "rating"
  vehicleCountry?: string; // valeurs exactes = via fetchFilters
  vehicleType?: string;
  vehicleClass?: string;
  vehicle?: string;
  searchString?: string; // recherche par HASHTAG — construire avec searchTag()
  page?: number;
}

export function thumbnail(skin: Skin): string {
  const img = skin.images[0];
  return img?.src ?? img?.orig?.src ?? "";
}

// Les items n'ont pas de champ `tags` : les hashtags sont noyés dans le HTML de
// `description`, balisés par la classe WTL-Embed-Hashtag. C'est la seule source.
export function tags(skin: Skin): string[] {
  const out = new Set<string>();
  const re = /class="WTL-Embed-Hashtag"[^>]*>\s*#?([^<]+?)\s*</g;
  for (const m of (skin.description ?? "").matchAll(re)) {
    const t = m[1].trim().toLowerCase();
    if (t) out.add(t);
  }
  return [...out];
}

/**
 * La recherche texte de Live est en réalité une recherche par hashtag : le `#`
 * est OBLIGATOIRE ("mirage" → 0 résultat, "#mirage" → 25 résultats). Insensible
 * à la casse, pas d'espace après le `#`. Enchaîner plusieurs tags n'est PAS un
 * ET (le dernier gagne) — ne pas le proposer dans l'UI.
 * Les tags sont saisis par les auteurs : couverture inégale, donc un complément
 * aux filtres véhicule, jamais un substitut.
 */
export function searchTag(term: string): string {
  const t = term.trim().replace(/^#+/, "").replace(/\s+/g, "");
  return t ? `#${t}` : "";
}

// ------------------------- Couche API (commune à tous les types) ------------------------- //

// 1. Recherche / liste — POST /api/feed/get_regular/ (JSON propre)
export async function fetchPage(p: SearchParams = {}): Promise<Page> {
  const body = new URLSearchParams({
    content: assertContentType(p.content ?? "camouflage"),
    sort: assertSort(p.sort ?? "rating"),
    user: "",
    // `period` est accepté mais sans effet mesurable (day/week/month/year
    // renvoient tous le même feed) : on ne l'expose pas dans l'UI.
    period: "",
    searchString: p.searchString ?? "",
    featured: "0",
    subtype: "all",
    page: String(p.page ?? 0),
    vehicleCountry: p.vehicleCountry ?? "",
    vehicleType: p.vehicleType ?? "",
    vehicleClass: p.vehicleClass ?? "",
    vehicle: p.vehicle ?? "",
  });

  const res = await apiFetch(url(ENDPOINTS.api.feed), {
    method: "POST",
    headers: ENDPOINTS.headers,
    body,
  });
  if (!res.ok) fail(ERR.api, `get_regular ${res.status}`);
  return (await res.json()) as Page;
}

// 2. Filtres — POST /api/feed/get_head/  ATTENTION: renvoie du HTML, pas du JSON.
//    La taxonomie est dans une variable JS `const filters = {...};` à extraire.
export async function fetchFilters(
  content: ContentType = "camouflage"
): Promise<unknown> {
  const body = new URLSearchParams({
    content: assertContentType(content),
    sort: "rating",
    user: "",
    period: "",
    searchString: "",
    page: "0",
    featured: "0",
    subtype: "all",
  });

  const res = await apiFetch(url(ENDPOINTS.api.head), {
    method: "POST",
    headers: ENDPOINTS.headers,
    body,
  });
  if (!res.ok) fail(ERR.api, `get_head ${res.status}`);

  const html = await res.text();
  const m = html.match(new RegExp(ENDPOINTS.filtersPattern));
  if (!m) fail(ERR.filtersBlock);
  return JSON.parse(m[1]);
  // { vehicleCountry, vehicleType, vehicleClass, vehicle }, chacun
  // { placeholder, variants: [{ value, name, count, dep }] }. `dep` = cascade.
}

// 3. Un post précis — POST /api/posts/get/
//    Sert à ré-afficher un contenu installé sans avoir à le retrouver dans le feed.
//    Réponse : le Skin à la RACINE, pas sous `data` (contrairement aux feeds).
export async function fetchPost(lang_group: number, language = "en"): Promise<Skin> {
  const res = await apiFetch(url(ENDPOINTS.api.post), {
    method: "POST",
    headers: ENDPOINTS.headers,
    body: new URLSearchParams({ lang_group: String(lang_group), language }),
  });
  if (!res.ok) fail(ERR.api, `posts/get ${res.status}`);
  return (await res.json()) as Skin;
}

/**
 * 4. Les créations d'un auteur — POST /api/feed/get_user/
 *
 * Trois pièges, tous vérifiés en sniffant la page profil du site :
 *  - `user` doit être l'ID NUMÉRIQUE (author.id) ; le pseudo renvoie 404 ;
 *  - l'endpoint refuse `content` : l'ajouter fait tomber en 404, donc le tri
 *    par type se fait ici, côté client ;
 *  - le feed d'un auteur mélange TOUS ses posts, y compris `image` et `video`
 *    qui n'ont AUCUN champ `file`. Les laisser passer ferait planter l'install.
 *
 * Conséquence assumée : une page de 25 posts peut ne donner que 17 camouflages.
 * Le décompte affiché est donc celui de la page, pas un total.
 */
export async function fetchUserPage(p: {
  user: number;
  content?: ContentType;
  sort?: SortKey;
  page?: number;
}): Promise<Page> {
  const body = new URLSearchParams({ user: String(p.user), page: String(p.page ?? 0) });
  if (p.sort) body.set("sort", assertSort(p.sort));

  const res = await apiFetch(url(ENDPOINTS.api.user), {
    method: "POST",
    headers: ENDPOINTS.headers,
    body,
  });
  if (!res.ok) fail(ERR.api, `get_user ${res.status}`);
  const json = (await res.json()) as Page;

  const want = assertContentType(p.content ?? "camouflage");
  const list = (json.data?.list ?? []).filter((s) => s.type === want && !!s.file?.link);
  return { data: { list, pageTitle: json.data?.pageTitle ?? "" } };
}

/**
 * 5. La police d'icônes des véhicules.
 *
 * Gaijin préfixe certains noms de véhicules d'un caractère marqueur (`▄M163`,
 * `▀CR.42`, `▂A-20G-30`). Ce ne sont pas des blocs décoratifs : la police
 * maison de Live, `Skyquake`, les dessine en insignes nationaux — cocarde RAF,
 * croix allemande, étoile soviétique, soleil levant japonais. Le site l'applique
 * exactement là où on en a besoin, sur `.filterItem[type='vehicle'] .option`.
 *
 * Elle est TÉLÉCHARGÉE au premier lancement puis mise en cache chez
 * l'utilisateur, jamais embarquée dans le binaire : c'est un actif de Gaijin,
 * on ne le redistribue pas. Sans elle, les marqueurs s'affichent en caractères
 * bruts, ce qui reste lisible.
 */
export async function fetchVehicleFont(cacheFile: string): Promise<string | null> {
  try {
    return await fs.readFile(cacheFile, "base64");
  } catch {
    // pas encore en cache
  }
  try {
    const res = await fetch(url(ENDPOINTS.vehicleFont), {
      headers: {
        "User-Agent": ENDPOINTS.headers["User-Agent"] ?? "",
        Referer: ENDPOINTS.headers.Referer ?? ENDPOINTS.base,
      },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    // Une réponse d'erreur déguisée en 200 ne doit pas être mise en cache.
    if (buf.length < 1024 || buf.subarray(0, 4).toString("latin1") !== "wOF2") return null;
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, buf);
    return buf.toString("base64");
  } catch {
    // Hors ligne, ou Live a bougé le fichier : on s'en passe.
    return null;
  }
}

// ------------------------- Abstraction d'installation ------------------------- //

export interface WtConfig {
  gameDir: string; // racine …/War Thunder
  installed: InstalledRecord[];
}

/**
 * Empreinte d'un contenu, pour repérer une republication.
 *
 * Un auteur qui met à jour son camouflage garde le même `lang_group` mais
 * change l'archive. Comparer taille et nom de fichier, plus l'identifiant de
 * variante, suffit à le détecter sans télécharger quoi que ce soit.
 */
export function fingerprint(skin: Skin): string {
  return `${skin.id}:${skin.file.size}:${skin.file.name}`;
}

export interface InstalledRecord {
  contentType: ContentType;
  lang_group: number;
  path: string; // ce qui a été posé sur le disque (dossier ou set de fichiers)
  name: string; // nom du dossier, celui que le jeu affiche
  installedAt: number;
  // Instantané du post au moment de l'install : permet de réafficher la fiche
  // complète sans une requête par contenu installé. fetchPost sert de repli
  // pour les enregistrements qui n'en ont pas.
  snapshot?: Skin;
  /** Empreinte au moment de l'installation, comparée lors d'un rafraîchissement. */
  fingerprint?: string;
  /** Dernier rafraîchissement réussi de l'instantané. */
  refreshedAt?: number;
  meta?: Record<string, unknown>; // ex. pour le son : mutation de config.blk à annuler
}

export interface InstallProgress {
  phase: "download" | "extract";
  loaded: number;
  total: number; // 0 si inconnu (serveur sans Content-Length)
}

export interface InstallOptions {
  // Nom de dossier voulu. C'est ce que le joueur verra en jeu, d'où l'intérêt
  // de remplacer "su25_anime_3" par quelque chose de lisible.
  folderName?: string;
  onProgress?: (p: InstallProgress) => void;
  /** Abandon demandé par le joueur. Le dossier entamé est effacé derrière. */
  signal?: AbortSignal;
}

/**
 * Un Installer sait où va un type de contenu, comment l'installer et le désinstaller.
 * Pour ajouter les viseurs ou le son : implémenter cette interface et l'enregistrer
 * dans `installers` plus bas. Le reste de l'app (IPC, UI) reste inchangé.
 */
export interface Installer {
  contentType: ContentType;
  // Où ce type s'installe. Async car certains types doivent DÉCOUVRIR le chemin
  // (ex. viseurs : …/Documents/My Games/WarThunder/Saves/<user-id>/production/UserSights).
  resolveDestination(config: WtConfig): Promise<string>;
  install(skin: Skin, config: WtConfig, opts?: InstallOptions): Promise<InstalledRecord>;
  uninstall(record: InstalledRecord, config: WtConfig): Promise<void>;
}

// ------------------------- Implémentation: CAMOUFLAGE (livrée) ------------------------- //

// ------------------------- Limites de téléchargement ------------------------- //

/**
 * `file.link` vient de la réponse de l'API, donc d'un tiers, et le renderer le
 * transmet tel quel. Sans liste blanche, un lien forgé ferait émettre au main
 * une requête vers n'importe quelle machine joignable depuis le poste — y
 * compris `localhost` et le réseau local (SSRF). Le téléchargement est donc
 * restreint aux hôtes qui servent réellement les archives de Live.
 */



/**
 * Le contrôle porte sur `hostname` d'une URL parsée, comparé par égalité à un
 * ensemble fermé — jamais par préfixe. Ça règle toute la famille d'un coup :
 *   live.warthunder.com.evil.com  → hostname entier, absent de l'ensemble
 *   https://live.warthunder.com@evil.com → hostname = evil.com, le reste n'est
 *                                          qu'un identifiant utilisateur
 *   LIVE.WARTHUNDER.COM           → normalisé en minuscules par URL
 *   livе.warthunder.com (е cyrillique) → punycodé, donc différent
 * Le port doit aussi être celui par défaut : un hôte légitime sur un port
 * inattendu n'a rien à nous servir.
 */
export function assertDownloadUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    fail(ERR.badSource, String(raw));
  }
  if (u.protocol !== "https:" || u.port !== "" || !ENDPOINTS.downloadHosts.includes(u.hostname.toLowerCase())) {
    fail(ERR.badSource, `${u.protocol}//${u.host}`);
  }
  return u.toString();
}

/**
 * Les redirections ne peuvent pas être interdites : `/dl/<jeton>/` répond 302
 * vers cdn-live.warthunder.com, c'est le fonctionnement normal. Mais les
 * laisser suivre automatiquement rouvrirait le SSRF par la bande — il suffirait
 * qu'un lien légitime renvoie vers 127.0.0.1. On les suit donc à la main, en
 * revalidant CHAQUE saut contre la même liste blanche.
 */
async function fetchAllowed(raw: string, signal: AbortSignal): Promise<Response> {
  let url = assertDownloadUrl(raw);

  for (let hop = 0; hop <= ENDPOINTS.limits.maxRedirects; hop++) {
    const res = await fetch(url, { redirect: "manual", signal });
    if (res.status < 300 || res.status >= 400) return res;

    const location = res.headers.get("location");
    if (!location) return res;
    // Une Location relative se résout contre le saut courant, puis repasse au
    // même contrôle : c'est le point où un hôte hostile essaierait d'entrer.
    url = assertDownloadUrl(new URL(location, url).toString());
  }
  fail(ERR.download, "too many redirects");
}

/**
 * Téléchargement en flux plutôt qu'en un bloc : c'est la seule façon de savoir
 * où on en est. Certains camouflages pèsent plus de 90 Mo.
 * `file.size` sert de total de repli quand le serveur n'annonce pas de longueur.
 *
 * Trois garde-fous, parce que tout ici vient d'un tiers : l'hôte est en liste
 * blanche, la taille est plafonnée (on met l'archive entière en mémoire, un
 * flux sans fin ferait tomber le process), et une minute sans octet coupe.
 */
async function downloadZip(
  url: string,
  expected: number,
  onProgress?: (p: InstallProgress) => void,
  external?: AbortSignal
): Promise<AdmZip> {
  const abort = new AbortController();
  let idle: ReturnType<typeof setTimeout> | null = null;
  const bump = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => abort.abort(new Error(ERR.downloadStalled)), ENDPOINTS.limits.idleMs);
  };

  // Deux raisons d'arrêter : l'inactivité, et le joueur qui annule. Le signal
  // combiné laisse distinguer les deux au moment de rendre l'erreur.
  const signal = external ? AbortSignal.any([abort.signal, external]) : abort.signal;

  try {
    bump();
    const res = await fetchAllowed(url, signal);
    if (!res.ok) fail(ERR.download, String(res.status));

    // Content-Length n'engage à rien, mais quand il annonce déjà trop gros,
    // autant refuser avant de transférer le moindre octet.
    const announced = Number(res.headers.get("content-length")) || 0;
    if (announced > ENDPOINTS.limits.maxDownloadBytes) fail(ERR.downloadTooBig, String(announced));

    const total = announced || expected || 0;
    if (!res.body) fail(ERR.download, "no body");

    const chunks: Uint8Array[] = [];
    let loaded = 0;
    const reader = res.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      bump();
      if (done) break;
      loaded += value.length;
      if (loaded > ENDPOINTS.limits.maxDownloadBytes) {
        await reader.cancel();
        fail(ERR.downloadTooBig, String(loaded));
      }
      chunks.push(value);
      onProgress?.({ phase: "download", loaded, total });
    }
    return new AdmZip(Buffer.concat(chunks));
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      // Deux abandons possibles : celui du joueur, et celui de l'inactivité.
      // Les confondre afficherait « le téléchargement ne répond plus » à
      // quelqu'un qui vient de cliquer sur Annuler.
      if (external?.aborted) fail(ERR.canceled);
      fail(ERR.downloadStalled);
    }
    throw e;
  } finally {
    if (idle) clearTimeout(idle);
  }
}

/**
 * Le seul garde-fou qui compte avant un rm -rf : `child` doit être STRICTEMENT
 * sous `parent`. Couvre d'un coup l'archive vide (skinPath === dest, qui ferait
 * supprimer UserSkins en entier au désinstall), une racine d'archive à `..`, et
 * un file.name hostile. adm-zip protège l'extraction ; ce chemin-là, c'est nous
 * qui le calculons, donc c'est à nous de le vérifier.
 */
function ensureInside(parent: string, child: string): string {
  const rel = path.relative(parent, child);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    fail(ERR.outsideDest, child);
  }
  return child;
}

/**
 * Assainit un nom de dossier. S'applique aussi bien au `file.name` venu du
 * serveur qu'au nom saisi par le joueur : dans les deux cas, séparateurs et
 * caractères interdits sous Windows dehors, plus les noms réservés du système.
 */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function safeFolderName(raw: string): string {
  const base = raw.replace(/\.zip$/i, "");
  let clean = base
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/[. ]+$/, "")
    .trim();
  if (WINDOWS_RESERVED.test(clean)) clean = `_${clean}`;
  if (!clean) fail(ERR.badFolderName, raw);
  return clean.slice(0, 120);
}

/**
 * Nom proposé par défaut au moment d'installer : celui de l'archive, nettoyé.
 * Le joueur peut le remplacer — c'est ce nom que le jeu affichera, et
 * "su25_anime_3" ne dit rien une fois dans le hangar.
 */
export function suggestedName(skin: Skin): string {
  return safeFolderName(path.basename(skin.file.name));
}

// Détecte si l'archive est "sale" (fichiers en vrac / plusieurs racines) et doit
// être enrobée dans un dossier, vs "propre" (un seul dossier racine).
function analyzeArchive(zip: AdmZip): { needsWrapper: boolean; root: string | null } {
  let needsWrapper = false;
  let root: string | null = null;
  for (const e of zip.getEntries()) {
    const parts = e.entryName.split("/");
    const first = parts[0] ?? "";
    const hasSubfolder = parts.length > 1 && parts[1] !== "";
    if (!hasSubfolder && !e.entryName.endsWith("/")) {
      needsWrapper = true;
      break;
    }
    if (root !== null && root !== first) {
      needsWrapper = true;
      break;
    }
    if (root === null) root = first;
  }
  // Archive vide, ou racine inexploitable : aucun dossier fiable à tracker → on enrobe.
  if (!root || root === "." || root === "..") needsWrapper = true;
  return { needsWrapper, root };
}

/**
 * Extraction entrée par entrée, au lieu de extractAllTo.
 *
 * Trois raisons : le dossier de destination porte le nom choisi par le joueur
 * (donc pour une archive « propre » il faut retirer son dossier racine, sinon
 * on obtiendrait MonNom/DossierOrigine/…), on peut rapporter la progression,
 * et chaque chemin est vérifié individuellement au lieu de faire confiance à
 * la protection d'adm-zip.
 */
async function extractInto(
  zip: AdmZip,
  target: string,
  stripRoot: boolean,
  onProgress?: (p: InstallProgress) => void,
  signal?: AbortSignal
): Promise<number> {
  const files = zip.getEntries().filter((e) => !e.isDirectory);
  let written = 0;

  /**
   * Une bombe zip tient dans quelques mégaoctets et se déplie en téraoctets :
   * sans plafond, on remplirait le disque du joueur. On lit les tailles
   * annoncées dans l'en-tête AVANT d'écrire quoi que ce soit, puis on
   * recompte à l'écriture — un en-tête peut mentir.
   */
  if (files.length > ENDPOINTS.limits.maxEntries) fail(ERR.archiveTooBig, `${files.length} entrées`);
  const announced = files.reduce((sum, e) => sum + (e.header?.size ?? 0), 0);
  if (announced > ENDPOINTS.limits.maxExtractedBytes) fail(ERR.archiveTooBig, String(announced));

  let bytes = 0;

  for (const entry of files) {
    // Entre deux fichiers : c'est le seul endroit où couper proprement, une
    // écriture en cours n'est pas interruptible.
    if (signal?.aborted) fail(ERR.canceled);

    const rel = stripRoot
      ? entry.entryName.split("/").slice(1).join("/")
      : entry.entryName;
    if (!rel) continue;

    // Un `..` dans le nom d'entrée fait échouer l'install au lieu d'être ignoré
    // en silence : une archive qui tente d'écrire ailleurs n'est pas un détail.
    const out = ensureInside(target, path.resolve(target, rel));
    const data = entry.getData();
    bytes += data.length;
    if (bytes > ENDPOINTS.limits.maxExtractedBytes) fail(ERR.archiveTooBig, String(bytes));

    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, data);
    written++;
    onProgress?.({ phase: "extract", loaded: written, total: files.length });
  }
  return written;
}

export const camouflageInstaller: Installer = {
  contentType: "camouflage",

  async resolveDestination(config) {
    return path.join(config.gameDir, "UserSkins");
  },

  async install(skin, config, opts) {
    const dest = await this.resolveDestination(config);
    await fs.mkdir(dest, { recursive: true });

    const zip = await downloadZip(skin.file.link, skin.file.size, opts?.onProgress, opts?.signal);
    const { needsWrapper } = analyzeArchive(zip);

    const name = safeFolderName(opts?.folderName?.trim() || suggestedName(skin));
    const skinPath = ensureInside(dest, path.join(dest, name));
    await fs.mkdir(skinPath, { recursive: true });

    // Archive « propre » : son dossier racine est remplacé par le nom choisi.
    // Archive « sale » : les fichiers en vrac sont posés tels quels dedans.
    // Toute sortie anormale efface le dossier : une extraction interrompue
    // laisserait sinon des fichiers non suivis, invisibles du désinstall.
    let written: number;
    try {
      written = await extractInto(zip, skinPath, !needsWrapper, opts?.onProgress, opts?.signal);
    } catch (e) {
      await fs.rm(skinPath, { recursive: true, force: true });
      throw e;
    }
    if (written === 0) {
      await fs.rm(skinPath, { recursive: true, force: true });
      fail(ERR.emptyArchive);
    }

    return {
      contentType: "camouflage",
      lang_group: skin.lang_group,
      path: skinPath,
      name,
      installedAt: Date.now(),
      snapshot: skin,
      fingerprint: fingerprint(skin),
      refreshedAt: Date.now(),
    };
  },

  async uninstall(record, config) {
    const dest = await this.resolveDestination(config);
    ensureInside(dest, record.path); // jamais de rm -rf ailleurs que sous UserSkins
    await fs.rm(record.path, { recursive: true, force: true });
  },
};

/**
 * Dossiers présents dans la destination mais que l'application n'a pas posés.
 *
 * Les templates livrés par Gaijin et les skins installés à la main sont
 * invisibles de l'app, alors qu'un joueur veut les voir. On les liste en
 * lecture seule : ils ne sont jamais désinstallables, c'est le contrat.
 */
export async function listForeign(
  config: WtConfig,
  content: ContentType = "camouflage"
): Promise<Array<{ name: string; path: string; modifiedAt: number }>> {
  const dest = await getInstaller(content).resolveDestination(config);
  const ours = new Set(
    config.installed
      .filter((r) => r.contentType === content)
      .map((r) => path.basename(r.path).toLowerCase())
  );

  let entries;
  try {
    entries = await fs.readdir(dest, { withFileTypes: true });
  } catch {
    return []; // dossier absent : rien à signaler
  }

  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || ours.has(e.name.toLowerCase())) continue;
    let modifiedAt = 0;
    try {
      modifiedAt = (await fs.stat(path.join(dest, e.name))).mtimeMs;
    } catch {
      /* dossier disparu entre-temps */
    }
    out.push({ name: e.name, path: path.join(dest, e.name), modifiedAt });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ------------------------- Implémentation: VISEURS ------------------------- //

/**
 * Retrouve le dossier des viseurs du compte courant.
 *
 * Les viseurs ne vivent pas dans le dossier du jeu mais sous
 * `Documents/My Games/WarThunder/Saves/<uid>/production/UserSights`, avec un
 * dossier par compte connecté sur la machine.
 *
 * Le brief prévoyait de demander à l'utilisateur en cas d'ambiguïté. Ce n'est
 * pas nécessaire : le jeu écrit `Saves/lastlogin.blk` contenant
 * `uid:i64=<identifiant>`, qui désigne le dernier compte utilisé. On s'en sert,
 * et on ne retombe sur un choix automatique que s'il manque.
 */
export async function resolveSightsDir(): Promise<string | null> {
  const saves = path.join(homedir(), "Documents", "My Games", "WarThunder", "Saves");

  let accounts: string[];
  try {
    accounts = (await fs.readdir(saves, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => e.name);
  } catch {
    return null; // le jeu n'a jamais été lancé sur cette machine
  }
  if (accounts.length === 0) return null;

  let chosen = accounts[0];
  if (accounts.length > 1) {
    try {
      const blk = await fs.readFile(path.join(saves, "lastlogin.blk"), "utf8");
      const uid = blk.match(/uid\s*:\s*i64\s*=\s*(\d+)/)?.[1];
      if (uid && accounts.includes(uid)) chosen = uid;
    } catch {
      // Pas de lastlogin lisible : on garde le premier compte trouvé plutôt
      // que d'échouer. Le joueur verra le chemin exact dans l'application.
    }
  }
  return path.join(saves, chosen, "production", "UserSights");
}

/**
 * Identifiants de véhicules connus, tirés de la taxonomie embarquée.
 *
 * Ils servent à reconnaître la structure d'une archive de viseurs : les
 * dossiers y portent les mêmes identifiants que ceux de Live.
 */
let vehicleIds: Set<string> | null = null;

export function setVehicleIds(ids: Iterable<string>): void {
  vehicleIds = new Set([...ids].map((v) => v.toLowerCase()));
}

/**
 * Retire une liste de fichiers, puis les dossiers qu'ils laissent vides.
 *
 * Sert au retrait comme à l'annulation. On ne supprime jamais un dossier
 * entier : `all_tanks` et les dossiers de véhicules sont partagés entre
 * paquets, en effacer un emporterait le travail d'un autre auteur.
 */
async function removeFiles(dest: string, relatives: string[]): Promise<void> {
  for (const rel of relatives) {
    try {
      await fs.rm(ensureInside(dest, path.resolve(dest, rel)), { force: true });
    } catch {
      // Chemin hors périmètre ou fichier déjà disparu : on continue.
    }
  }
  const dirs = [...new Set(relatives.map((f) => path.dirname(f)).filter((d) => d && d !== "."))];
  for (const d of dirs) {
    try {
      const target = ensureInside(dest, path.resolve(dest, d));
      if ((await fs.readdir(target)).length === 0) await fs.rmdir(target);
    } catch {
      /* dossier non vide ou déjà retiré */
    }
  }
}

export const sightInstaller: Installer = {
  contentType: "sight",

  async resolveDestination() {
    const dir = await resolveSightsDir();
    if (!dir) fail(ERR.noSightsDir);
    return dir;
  },

  async install(skin, config, opts) {
    const dest = await this.resolveDestination(config);
    await fs.mkdir(dest, { recursive: true });

    const zip = await downloadZip(skin.file.link, skin.file.size, opts?.onProgress, opts?.signal);
    const entries = zip.getEntries().map((e) => e.entryName);
    const plan = planSightLayout(entries, vehicleIds ?? new Set());
    // Poser un viseur au mauvais endroit ne se voit pas : il n'apparaît
    // simplement jamais en jeu. Mieux vaut refuser que laisser croire.
    if (!plan) fail(ERR.unknownLayout, skin.file.name);

    const files = zip.getEntries().filter((e) => !e.isDirectory);
    let written = 0;
    const touched: string[] = [];

    for (const entry of files) {
      if (opts?.signal?.aborted) {
        // Les viseurs se dispersent parmi des fichiers existants : abandonner
        // sans retirer ce qui vient d'être posé laisserait un paquet à moitié
        // installé, que rien ne suivrait.
        await removeFiles(dest, touched);
        fail(ERR.canceled);
      }

      let rel = entry.entryName;
      if (plan.strip) {
        if (!rel.toLowerCase().startsWith(plan.strip.toLowerCase())) continue;
        rel = rel.slice(plan.strip.length);
      }
      if (!rel || !rel.toLowerCase().endsWith(".blk")) continue;
      // Cas d'un réticule nu : il n'a pas de dossier, on le range sous all_tanks.
      if (plan.via === "single-vehicle") {
        if (rel.includes("/")) continue;
        rel = `${plan.vehicles[0]}/${rel}`;
      }

      const out = ensureInside(dest, path.resolve(dest, rel));
      await fs.mkdir(path.dirname(out), { recursive: true });
      await fs.writeFile(out, entry.getData());
      touched.push(rel);
      written++;
      opts?.onProgress?.({ phase: "extract", loaded: written, total: files.length });
    }

    if (written === 0) fail(ERR.emptyArchive);

    const name = safeFolderName(opts?.folderName?.trim() || suggestedName(skin));
    return {
      contentType: "sight",
      lang_group: skin.lang_group,
      // Les viseurs se dispersent dans des dossiers de véhicules partagés avec
      // d'autres paquets : on suit chaque fichier posé plutôt qu'un dossier,
      // sinon la désinstallation emporterait le travail des autres.
      path: dest,
      name,
      installedAt: Date.now(),
      snapshot: skin,
      fingerprint: fingerprint(skin),
      refreshedAt: Date.now(),
      meta: { files: touched, via: plan.via, rootOnly: plan.rootOnly ?? false },
    };
  },

  async uninstall(record) {
    await removeFiles(record.path, (record.meta?.files as string[] | undefined) ?? []);
  },
};

// ------------------------- Registre des installers ------------------------- //
// Enregistrer ici chaque type supporté. Aujourd'hui : camouflage uniquement.
// Extensions à brancher (voir brief) : sightInstaller, soundInstaller, …
export const installers: Partial<Record<ContentType, Installer>> = {
  camouflage: camouflageInstaller,
  sight: sightInstaller,
};

export function getInstaller(content: ContentType): Installer {
  const inst = installers[assertContentType(content)];
  if (!inst) fail(ERR.noInstaller, content);
  return inst;
}
