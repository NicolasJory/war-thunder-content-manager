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
import { createWriteStream, promises as fs } from "fs";
import path from "path";
import { ERR, fail } from "../shared/errors.js";
import { DEFAULT_ENDPOINTS, type Endpoints } from "../shared/endpoints.js";
import { planSightLayout } from "./sightLayout.js";
import { isRisky, slotOf } from "./soundSlots.js";
import {
  defaultSelection,
  isValidSelection,
  patchSoundBlock,
  planSoundLayout,
  soundEntriesFor,
  targetName,
  type SoundPlan,
} from "./soundLayout.js";
import { homedir } from "os";
import { tmpdir } from "os";

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
  /**
   * Dossiers de l'archive retenus (mods son). Une archive dont plusieurs
   * dossiers posent les mêmes banques ne s'installe pas sans ce choix.
   */
  groups?: string[];
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
  /**
   * Pose ou retire le contenu sans toucher à ce qui a été téléchargé.
   *
   * Seul le son en a besoin : ses archives pèsent jusqu'à 850 Mo, donc son
   * enregistrement distingue « téléchargé » de « posé dans le jeu ». Un
   * camouflage n'a pas cet état intermédiaire, et n'implémente pas ceci.
   */
  setActive?(
    record: InstalledRecord,
    active: boolean,
    config: WtConfig,
    opts?: InstallOptions
  ): Promise<InstalledRecord>;
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
async function fetchAllowed(
  raw: string,
  signal: AbortSignal,
  headers?: Record<string, string>
): Promise<Response> {
  let url = assertDownloadUrl(raw);

  for (let hop = 0; hop <= ENDPOINTS.limits.maxRedirects; hop++) {
    const res = await fetch(url, { redirect: "manual", signal, headers });
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
 * Téléchargement en flux, écrit AU FIL DE L'EAU dans `dest`.
 *
 * L'ancienne version accumulait les morceaux dans un tableau puis appelait
 * `Buffer.concat` : les deux vivaient en même temps, soit deux fois la taille
 * de l'archive. Ça passait pour un camouflage de 90 Mo, pas pour un mod son de
 * 853 Mo. Le flux part maintenant sur disque et rien ne s'accumule ici.
 *
 * Plafond connu, mesuré sur ETSMIV (853 Mo, la plus grosse du catalogue) :
 * l'installation culmine à 1,7 Go de RSS. `adm-zip` 0.6 fait un
 * `fs.readFileSync` même quand on lui passe un CHEMIN (adm-zip.js:72), donc
 * l'archive entière repasse en mémoire, puis `getData()` y ajoute la plus
 * grosse entrée décompressée (313 Mo ici). Le pic vaut donc à peu près
 * « archive + plus grosse banque ». Descendre plus bas demande un lecteur de
 * zip qui lise vraiment à la demande — yauzl — et ça change les trois
 * installers d'un coup : à faire seulement si quelqu'un se plaint.
 *
 * `file.size` sert de total de repli quand le serveur n'annonce pas de longueur.
 *
 * Trois garde-fous, parce que tout ici vient d'un tiers : l'hôte est en liste
 * blanche, la taille est plafonnée, et une minute sans octet coupe.
 *
 * Le fichier partiel est effacé sur toute sortie anormale : un zip tronqué
 * laissé en place serait rouvert tel quel au prochain essai.
 */
async function downloadZip(
  url: string,
  expected: number,
  dest: string,
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

  await fs.mkdir(path.dirname(dest), { recursive: true });
  const out = createWriteStream(dest);
  // Le rappel de `write` se déclenche une fois le morceau écoulé : l'attendre
  // suffit à tenir la contre-pression sans machinerie de flux.
  const write = (chunk: Uint8Array) =>
    new Promise<void>((resolve, reject) => {
      out.write(chunk, (err) => (err ? reject(err) : resolve()));
    });

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
      await write(value);
      onProgress?.({ phase: "download", loaded, total });
    }

    await new Promise<void>((resolve, reject) =>
      out.end((err: NodeJS.ErrnoException | null | undefined) => (err ? reject(err) : resolve()))
    );
    return new AdmZip(dest);
  } catch (e) {
    out.destroy();
    await fs.rm(dest, { force: true });
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
 * Emplacement d'un zip pendant le temps de l'installation. Les camouflages et
 * les viseurs n'en gardent rien : le fichier est effacé une fois extrait.
 */
function scratchZip(skin: Skin): string {
  return path.join(tmpdir(), "wt-manager", `${skin.lang_group}-${Date.now()}.zip`);
}

/**
 * Liste les entrées d'une archive SANS la télécharger, en lisant son index.
 *
 * Un zip range son sommaire à la fin. Deux requêtes Range suffisent donc : les
 * derniers kilo-octets pour trouver l'en-tête de fin, puis le sommaire lui-même.
 * Sur un mod son de 850 Mo ça représente quelques dizaines de kilo-octets, ce
 * qui permet de poser la question du choix des dossiers AVANT de faire
 * patienter le joueur dix minutes.
 *
 * Rend `null` si le serveur ne suit pas (pas de Range, zip64, index illisible).
 * L'appelant retombe alors sur le téléchargement complet, qui sait faire le
 * même classement une fois l'archive sur le disque.
 */
export async function readZipIndex(url: string, external?: AbortSignal): Promise<string[] | null> {
  const timeout = AbortSignal.timeout(ENDPOINTS.limits.apiTimeoutMs);
  const signal = external ? AbortSignal.any([timeout, external]) : timeout;

  const grab = async (spec: string): Promise<Buffer | null> => {
    const res = await fetchAllowed(url, signal, { ...ENDPOINTS.headers, Range: `bytes=${spec}` });
    // 206 seulement : un 200 signifie que le serveur a ignoré le Range et
    // s'apprête à nous servir l'archive entière, ce qu'on ne veut surtout pas.
    if (res.status !== 206 || !res.body) return null;
    return Buffer.from(await res.arrayBuffer());
  };

  try {
    // 65 557 = taille maxi d'un en-tête de fin, commentaire compris.
    const tail = await grab("-65557");
    if (!tail) return null;

    const at = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    if (at < 0 || at + 20 > tail.length) return null;

    const size = tail.readUInt32LE(at + 12);
    const offset = tail.readUInt32LE(at + 16);
    // 0xffffffff = marqueur zip64, l'index est ailleurs et autrement formé.
    if (size === 0 || offset === 0xffffffff || size === 0xffffffff) return null;
    // Le sommaire passe en mémoire : on le plafonne comme le reste.
    if (size > 16 * 1024 * 1024) return null;

    const cd = await grab(`${offset}-${offset + size - 1}`);
    if (!cd || cd.length < size) return null;

    const names: string[] = [];
    let p = 0;
    while (p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50) {
      const nameLen = cd.readUInt16LE(p + 28);
      const extraLen = cd.readUInt16LE(p + 30);
      const commentLen = cd.readUInt16LE(p + 32);
      if (p + 46 + nameLen > cd.length) return null;
      names.push(cd.toString("utf8", p + 46, p + 46 + nameLen));
      p += 46 + nameLen + extraLen + commentLen;
      if (names.length > ENDPOINTS.limits.maxEntries) return null;
    }
    return names.length ? names : null;
  } catch {
    // Réseau capricieux ou serveur sans Range : ce chemin n'est qu'un confort,
    // son échec ne doit jamais empêcher une installation.
    return null;
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

    const scratch = scratchZip(skin);
    try {
      const zip = await downloadZip(
        skin.file.link,
        skin.file.size,
        scratch,
        opts?.onProgress,
        opts?.signal
      );
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
    } finally {
      // adm-zip lit l'archive depuis le disque : elle doit vivre jusqu'à la
      // fin de l'extraction, et pas une seconde de plus. Un camouflage ne se
      // garde pas, contrairement à un mod son.
      await fs.rm(scratch, { force: true });
    }
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

    const scratch = scratchZip(skin);
    try {
      const zip = await downloadZip(
        skin.file.link,
        skin.file.size,
        scratch,
        opts?.onProgress,
        opts?.signal
      );
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

      // Un chemin déjà réclamé par un autre paquet sight installé vient d'être
      // écrasé sur disque : l'utilisateur ne peut pas le voir autrement, ça se
      // signale plutôt que ça se cache.
      const others = config.installed.filter((r) => r.contentType === "sight");
      const overwritten = others.filter((r) =>
        ((r.meta?.files as string[] | undefined) ?? []).some((f) => touched.includes(f))
      );

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
        meta: {
          files: touched,
          via: plan.via,
          rootOnly: plan.rootOnly ?? false,
          overwrites: overwritten.map((r) => r.name),
        },
      };
    } finally {
      // adm-zip lit l'archive depuis le disque : elle doit vivre jusqu'à la
      // fin de l'extraction, et pas une seconde de plus. Un camouflage ne se
      // garde pas, contrairement à un mod son.
      await fs.rm(scratch, { force: true });
    }
  },

  async uninstall(record, config) {
    // Un chemin encore réclamé par un autre paquet sight installé appartient
    // désormais à ce paquet-là : le retirer casserait son travail en silence.
    const claimed = new Set(
      config.installed
        .filter((r) => r.contentType === "sight" && r !== record)
        .flatMap((r) => (r.meta?.files as string[] | undefined) ?? [])
    );
    const mine = ((record.meta?.files as string[] | undefined) ?? []).filter(
      (f) => !claimed.has(f)
    );
    await removeFiles(record.path, mine);
  },
};

// ------------------------- Implémentation: MODS SON ------------------------- //

/**
 * Où sont conservés les zips des mods son. Injecté au démarrage depuis
 * `app.getPath("userData")` — wtLive.ts n'importe pas electron.
 *
 * Le dossier du jeu peut être sur un autre disque que la configuration : garder
 * les archives dans l'arbre du jeu obligerait à gérer deux emplacements
 * possibles, pour un bénéfice nul.
 */
let libraryDir: string | null = null;

export function setLibraryDir(dir: string): void {
  libraryDir = dir;
}

function libraryZip(langGroup: number): string {
  if (!libraryDir) fail(ERR.noLibrary);
  return path.join(libraryDir, "sound", `${langGroup}.zip`);
}

/**
 * Ce qu'on retient d'un mod son, en plus du tronc commun.
 *
 * Un mod son a un état de plus que les autres types : il peut être téléchargé
 * sans être posé dans le jeu. `active` porte cette distinction, `zip` désigne
 * l'archive conservée qui permet de le reposer sans retélécharger 850 Mo.
 */
export interface SoundMeta {
  /** Banques posées dans `sound/mod`, sans dossier : le jeu les lit à plat. */
  files: string[];
  /** Dossiers de l'archive retenus par l'utilisateur. */
  groups: string[];
  active: boolean;
  /** Ordre de superposition : le dernier activé l'emporte sur un même fichier. */
  activatedAt: number;
  /** La ligne `enable_mod` de config.blk vient de nous, donc on la retirera. */
  addedEnableMod: boolean;
  /** Mods dont ce mod a recouvert au moins une banque en s'activant. */
  overwrites: string[];
  /** Chemin de l'archive conservée. */
  zip: string;
  /**
   * Toutes les banques que ce mod PEUT poser, selon les dossiers retenus.
   *
   * `files` dit ce qu'il occupe à l'instant, `provides` ce qu'il sait occuper.
   * Les deux coïncidaient tant qu'un mod était tout ou rien ; le mixeur les
   * sépare, puisqu'un mod peut n'occuper que trois de ses dix emplacements.
   *
   * Absent des enregistrements d'avant le mixeur : `soundProvides` le
   * reconstruit alors depuis l'archive, une fois, et le récrit.
   */
  provides?: string[];
}

const soundMeta = (r: InstalledRecord): SoundMeta => r.meta as unknown as SoundMeta;

/**
 * Banques livrées par le jeu, lues dans `<jeu>/sound`.
 *
 * Elles servent à reconnaître les variantes qu'un auteur distingue par un
 * préfixe (`English_aircraft_gui.bank`) : sans ce catalogue, on les poserait
 * telles quelles et le jeu ne lirait aucune des trois. Même rôle que la
 * taxonomie des véhicules pour les viseurs.
 *
 * Lu depuis le disque plutôt qu'embarqué : la liste change à chaque mise à jour
 * du jeu, et une table figée deviendrait fausse en silence.
 */
export async function readStockBanks(config: WtConfig): Promise<string[]> {
  if (!config.gameDir) return [];
  try {
    const names = await fs.readdir(path.join(config.gameDir, "sound"));
    return names.filter((n) => n.toLowerCase().endsWith(".bank"));
  } catch {
    // Dossier absent ou illisible : le classement reste correct, simplement
    // moins fin. Refuser d'installer pour ça serait disproportionné.
    return [];
  }
}

/**
 * Retire à tous les autres mods la revendication des fichiers qu'on vient de
 * poser, et la donne à `owner`.
 *
 * `meta.files` répond à « qu'est-ce que ce mod occupe SUR LE DISQUE », pas
 * « qu'est-ce qu'il a posé un jour ». Sans ce recalage, installer un mod
 * par-dessus un autre laissait les deux revendiquer les mêmes noms : les
 * cartes annonçaient 16 et 17 fichiers pour un dossier qui n'en portait que
 * 17, et le mixeur ne savait plus dire à qui appartenait une place.
 *
 * Ce que le mod recouvert peut encore fournir n'est pas perdu pour autant :
 * `provides` le dit, et c'est là-dessus que `restoreCovered` s'appuie pour lui
 * rendre sa banque quand celui du dessus s'en va.
 */
export function reassignClaims(
  installed: InstalledRecord[],
  owner: number,
  files: string[]
): InstalledRecord[] {
  const taken = new Set(files.map((f) => f.toLowerCase()));

  return installed.map((record) => {
    if (record.contentType !== "sound" || record.lang_group === owner) return record;
    const meta = soundMeta(record);
    const kept = (meta?.files ?? []).filter((f) => !taken.has(f.toLowerCase()));
    if (kept.length === (meta?.files ?? []).length) return record;
    return {
      ...record,
      meta: { ...meta, files: kept, active: kept.length > 0 } as unknown as Record<string, unknown>,
    };
  });
}

/** Mods son actuellement posés dans le jeu, le plus récemment activé en tête. */
function activeSounds(config: WtConfig, exceptGroup?: number): InstalledRecord[] {
  return config.installed
    .filter((r) => r.contentType === "sound" && r.lang_group !== exceptGroup && soundMeta(r)?.active)
    .sort((a, b) => soundMeta(b).activatedAt - soundMeta(a).activatedAt);
}

/**
 * Pose à plat les banques des dossiers retenus. Le jeu ne descend pas dans les
 * sous-dossiers de `sound/mod` : une banque rangée dans un dossier n'est jamais
 * lue, et l'utilisateur n'a aucun moyen de comprendre pourquoi.
 */
async function layBanks(
  zip: AdmZip,
  plan: SoundPlan,
  groups: string[],
  dest: string,
  opts?: InstallOptions
): Promise<string[]> {
  const wanted = soundEntriesFor(plan, groups);
  if (wanted.length > ENDPOINTS.limits.maxEntries) fail(ERR.archiveTooBig, String(wanted.length));

  const byName = new Map(zip.getEntries().map((e) => [e.entryName, e]));
  const announced = wanted.reduce((sum, n) => sum + (byName.get(n)?.header?.size ?? 0), 0);
  if (announced > ENDPOINTS.limits.maxExtractedBytes) fail(ERR.archiveTooBig, String(announced));

  const laid: string[] = [];
  let bytes = 0;
  for (const entryName of wanted) {
    // Entre deux fichiers : le seul endroit où couper proprement, une écriture
    // en cours n'est pas interruptible.
    if (opts?.signal?.aborted) {
      await removeFiles(dest, laid);
      fail(ERR.canceled);
    }
    const entry = byName.get(entryName);
    if (!entry) continue;

    const data = entry.getData();
    bytes += data.length;
    if (bytes > ENDPOINTS.limits.maxExtractedBytes) {
      await removeFiles(dest, laid);
      fail(ERR.archiveTooBig, String(bytes));
    }

    // Une variante préfixée est posée sous le nom que le jeu lit vraiment.
    const name = targetName(plan, entryName);
    await fs.writeFile(ensureInside(dest, path.resolve(dest, name)), data);
    laid.push(name);
    opts?.onProgress?.({ phase: "extract", loaded: laid.length, total: wanted.length });
  }
  return laid;
}

/**
 * Repose les banques d'un mod recouvert, après le retrait de celui du dessus.
 *
 * Deux mods son se superposent volontiers — IASM nomme un de ses dossiers
 * « skip if mixing with RCSM », c'est dire s'il s'y attend. Quand les deux
 * livrent `masterbank.bank`, le dernier activé l'emporte. En retirant celui-là
 * sans reposer l'autre, le jeu se retrouverait sans banque du tout.
 *
 * L'archive du mod recouvert est encore là : elle ne part qu'à la
 * désinstallation. C'est précisément à ça qu'elle sert.
 */
async function restoreCovered(
  dest: string,
  removed: string[],
  config: WtConfig,
  exceptGroup: number
): Promise<string[]> {
  const want = new Set(removed.map((f) => f.toLowerCase()));
  const restored: string[] = [];
  const stock = await readStockBanks(config);

  for (const other of activeSounds(config, exceptGroup)) {
    if (want.size === 0) break;
    const meta = soundMeta(other);
    // Ce qu'il SAIT poser, pas ce qu'il occupe : justement, il ne l'occupe
    // plus, puisque le mod qu'on retire le lui avait pris.
    const peut = await soundProvides(other, config);
    if (!peut.some((f) => want.has(f.toLowerCase()))) continue;

    try {
      const zip = new AdmZip(meta.zip);
      const plan = planSoundLayout(zip.getEntries().map((e) => e.entryName), stock);
      if (!plan) continue;
      for (const entryName of soundEntriesFor(plan, meta.groups)) {
        const name = targetName(plan, entryName);
        if (!want.has(name.toLowerCase())) continue;
        const entry = zip.getEntry(entryName);
        if (!entry) continue;
        await fs.writeFile(ensureInside(dest, path.resolve(dest, name)), entry.getData());
        want.delete(name.toLowerCase());
        restored.push(name);
      }
    } catch {
      // Archive disparue ou illisible : on ne peut pas reposer sa banque. Le
      // mod du dessous perd un son, mais le jeu démarre — mieux que d'annuler
      // la désactivation en cours et de laisser l'utilisateur coincé.
    }
  }
  return restored;
}

/** Bascule `enable_mod` dans config.blk. Rend vrai si le fichier a bougé. */
async function setEnableMod(config: WtConfig, enable: boolean): Promise<boolean> {
  const blk = path.join(config.gameDir, "config.blk");
  let text: string;
  try {
    text = await fs.readFile(blk, "utf8");
  } catch {
    // Jeu jamais lancé : config.blk n'existe pas encore. Le créer ne servirait
    // à rien, le jeu le réécrit à son premier démarrage.
    if (!enable) return false;
    fail(ERR.noConfigBlk, blk);
  }
  const patched = patchSoundBlock(text, enable);
  if (patched.changed) await fs.writeFile(blk, patched.text, "utf8");
  return patched.changed;
}

/** Retire du jeu les banques d'un mod, en rendant la main à ceux du dessous. */
async function deactivateSound(record: InstalledRecord, config: WtConfig): Promise<void> {
  const meta = soundMeta(record);
  const dest = await soundInstaller.resolveDestination(config);

  await removeFiles(dest, meta.files);
  await restoreCovered(dest, meta.files, config, record.lang_group);

  // Dernier mod son à quitter le jeu : la ligne qu'on avait posée dans
  // config.blk n'a plus de raison d'être. Celle que le joueur avait mise
  // lui-même reste — `addedEnableMod` dit laquelle est à nous.
  const stillActive = activeSounds(config, record.lang_group);
  if (stillActive.length === 0 && meta.addedEnableMod) await setEnableMod(config, false);
}

/**
 * Banques présentes dans `sound/mod` que l'application n'a pas posées.
 *
 * Un joueur qui extrayait ses mods à la main avant d'avoir l'application en a
 * forcément : sur l'installation de test, OPEX 5.0.0 occupait ses seize
 * banques sans qu'aucun enregistrement ne le mentionne. Sans cette lecture,
 * l'avertissement de recouvrement est aveugle à tout ce qui n'est pas passé
 * par nous, et l'auteur de PCSM prévient précisément de ce piège : deux mods
 * qui se disputent `masterbank.bank` ne cohabitent pas.
 *
 * Pendant de `listForeign` pour les camouflages, à ceci près que l'unité est le
 * fichier et non le dossier : le jeu lit `sound/mod` à plat.
 *
 * On les liste, on ne les touche jamais. Ce qu'on n'a pas posé ne nous
 * appartient pas.
 */
export async function listForeignBanks(config: WtConfig): Promise<string[]> {
  const dest = await soundInstaller.resolveDestination(config);
  const ours = new Set(
    config.installed
      .filter((r) => r.contentType === "sound" && soundMeta(r)?.active)
      .flatMap((r) => soundMeta(r).files)
      .map((f) => f.toLowerCase())
  );

  try {
    const entries = await fs.readdir(dest, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile() && !ours.has(e.name.toLowerCase()))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return []; // dossier absent : aucun mod son posé, par nous ou par quiconque
  }
}

/**
 * Banques qu'un mod sait poser.
 *
 * Lu dans l'enregistrement quand il est là. Sinon reconstruit depuis l'archive
 * — le cas des mods installés avant le mixeur. On relit alors le zip en entier,
 * ce qui coûte cher sur 853 Mo, donc l'appelant récrit le résultat pour ne le
 * payer qu'une fois.
 */
export async function soundProvides(record: InstalledRecord, config: WtConfig): Promise<string[]> {
  const meta = soundMeta(record);
  if (meta?.provides) return meta.provides;
  if (!meta?.zip) return [];

  try {
    const zip = new AdmZip(meta.zip);
    const plan = planSoundLayout(
      zip.getEntries().map((e) => e.entryName),
      await readStockBanks(config)
    );
    if (!plan) return [];
    return soundEntriesFor(plan, meta.groups).map((e) => targetName(plan, e));
  } catch {
    // Archive disparue : le mod ne peut plus rien fournir, et le dire ainsi
    // vaut mieux que de proposer dans le mixeur un choix qui échouerait.
    return [];
  }
}

/**
 * État d'un emplacement : qui l'occupe, qui pourrait l'occuper.
 *
 * `owner` à null avec `foreign` faux signifie que le jeu joue son propre son.
 * `foreign` vrai veut dire qu'un fichier est là mais que l'application ne l'a
 * pas posé : elle peut l'écraser, pas le remettre, et le dit.
 */
export interface SoundSlot {
  slot: string;
  owner: number | null;
  foreign: boolean;
  /** `lang_group` des mods téléchargés capables de tenir cette place. */
  candidates: number[];
  risky: boolean;
}

/**
 * Le tableau du mixeur : un emplacement par ligne.
 *
 * Ne liste que les places qu'au moins un mod téléchargé sait occuper, plus
 * celles qui sont occupées aujourd'hui. Afficher les 139 banques du jeu quand
 * aucun mod n'en propose que vingt noierait le choix dans du vide.
 */
export async function listSoundSlots(config: WtConfig): Promise<SoundSlot[]> {
  const records = config.installed.filter((r) => r.contentType === "sound");
  const slots = new Map<string, SoundSlot>();

  const touch = (slot: string): SoundSlot => {
    let found = slots.get(slot);
    if (!found) {
      found = { slot, owner: null, foreign: false, candidates: [], risky: isRisky(slot) };
      slots.set(slot, found);
    }
    return found;
  };

  for (const record of records) {
    for (const file of await soundProvides(record, config)) {
      touch(slotOf(file)).candidates.push(record.lang_group);
    }
    // Ce qu'il occupe vraiment, même si `provides` ne le mentionnait plus.
    for (const file of soundMeta(record)?.files ?? []) {
      touch(slotOf(file)).owner = record.lang_group;
    }
  }

  // Ce qui est sur le disque sans venir de nous occupe une place bien réelle.
  for (const file of await listForeignBanks(config)) {
    const found = touch(slotOf(file));
    if (found.owner === null) found.foreign = true;
  }

  for (const found of slots.values()) {
    found.candidates = [...new Set(found.candidates)].sort((a, b) => a - b);
  }
  return [...slots.values()].sort((a, b) => a.slot.localeCompare(b.slot));
}

/**
 * Donne un emplacement à un mod, ou le rend au jeu.
 *
 * C'est l'unique opération du mixeur. Elle retire d'abord ce qui occupe la
 * place — fichiers ET revendication de l'ancien propriétaire — puis pose ceux
 * du nouveau. Retirer seulement le `.bank` laisserait l'audio du précédent.
 *
 * `to` à null rend la place au son d'origine du jeu : on efface, le jeu relit
 * sa propre banque dans `sound/`.
 */
export async function setSoundSlot(
  config: WtConfig,
  slot: string,
  to: number | null
): Promise<InstalledRecord[]> {
  const dest = await soundInstaller.resolveDestination(config);
  await fs.mkdir(dest, { recursive: true });

  // 1. Libérer la place. Tout ce qui porte ce nom s'en va, quelle qu'en soit
  //    l'origine — y compris un fichier posé à la main, que l'utilisateur vient
  //    justement de demander à remplacer.
  const present = await fs
    .readdir(dest)
    .catch(() => [] as string[])
    .then((names) => names.filter((n) => slotOf(n) === slot));
  await removeFiles(dest, present);

  const next = config.installed.map((record) => {
    if (record.contentType !== "sound") return record;
    const meta = soundMeta(record);
    const kept = (meta?.files ?? []).filter((f) => slotOf(f) !== slot);
    if (kept.length === (meta?.files ?? []).length) return record;
    return { ...record, meta: { ...meta, files: kept, active: kept.length > 0 } as unknown as Record<string, unknown> };
  });

  if (to === null) {
    await syncEnableMod({ ...config, installed: next });
    return next;
  }

  // 2. Poser celles du nouveau propriétaire.
  const record = next.find((r) => r.contentType === "sound" && r.lang_group === to);
  if (!record) fail(ERR.notInstalled, String(to));
  const meta = soundMeta(record);
  if (!meta?.zip) fail(ERR.notInstalled, String(to));

  const zip = new AdmZip(meta.zip);
  const plan = planSoundLayout(
    zip.getEntries().map((e) => e.entryName),
    await readStockBanks(config)
  );
  if (!plan) fail(ERR.emptyArchive);

  const wanted = soundEntriesFor(plan, meta.groups).filter((e) => slotOf(targetName(plan, e)) === slot);
  if (wanted.length === 0) fail(ERR.badArgs, slot);

  const laid: string[] = [];
  for (const entryName of wanted) {
    const entry = zip.getEntry(entryName);
    if (!entry) continue;
    const name = targetName(plan, entryName);
    await fs.writeFile(ensureInside(dest, path.resolve(dest, name)), entry.getData());
    laid.push(name);
  }
  if (laid.length === 0) fail(ERR.emptyArchive);

  const updated = next.map((r) =>
    r.contentType === "sound" && r.lang_group === to
      ? {
          ...r,
          meta: {
            ...soundMeta(r),
            files: [...(soundMeta(r)?.files ?? []), ...laid],
            active: true,
            activatedAt: Date.now(),
          } as unknown as Record<string, unknown>,
        }
      : r
  );

  await syncEnableMod({ ...config, installed: updated });
  return updated;
}

/**
 * Aligne `enable_mod` sur la réalité : posée tant qu'une banque est là, retirée
 * quand `sound/mod` se vide. Le mixeur peut vider le dossier emplacement par
 * emplacement, sans qu'aucune désactivation de mod ne soit passée par là.
 */
async function syncEnableMod(config: WtConfig): Promise<void> {
  const dest = await soundInstaller.resolveDestination(config);
  const reste = await fs.readdir(dest).catch(() => [] as string[]);
  if (reste.length > 0) {
    await setEnableMod(config, true);
    return;
  }
  // On ne retire que ce qu'on avait posé : un `enable_mod` écrit par le joueur
  // avant l'application ne nous appartient pas.
  const notre = config.installed.some(
    (r) => r.contentType === "sound" && soundMeta(r)?.addedEnableMod
  );
  if (notre) await setEnableMod(config, false);
}

export const soundInstaller: Installer = {
  contentType: "sound",

  async resolveDestination(config) {
    if (!config.gameDir) fail(ERR.noGameDir);
    return path.join(config.gameDir, "sound", "mod");
  },

  async install(skin, config, opts) {
    const dest = await this.resolveDestination(config);
    await fs.mkdir(dest, { recursive: true });

    // L'archive reste : c'est elle qui permettra de réactiver le mod sans
    // refaire 850 Mo de téléchargement. Elle ne part qu'à la désinstallation.
    const zipPath = libraryZip(skin.lang_group);
    const zip = await downloadZip(
      skin.file.link,
      skin.file.size,
      zipPath,
      opts?.onProgress,
      opts?.signal
    );

    const plan = planSoundLayout(
      zip.getEntries().map((e) => e.entryName),
      await readStockBanks(config)
    );
    if (!plan) {
      await fs.rm(zipPath, { force: true });
      fail(ERR.emptyArchive);
    }

    // La sélection vient de l'écran de choix, qui a lu l'index de l'archive
    // avant le téléchargement. Sans elle, on ne prend l'initiative que quand
    // l'archive n'a rien d'ambigu.
    let groups: string[];
    if (opts?.groups) {
      if (!isValidSelection(plan, opts.groups)) {
        await fs.rm(zipPath, { force: true });
        fail(ERR.badArgs, "groups");
      }
      groups = opts.groups;
    } else if (plan.needsChoice) {
      await fs.rm(zipPath, { force: true });
      fail(ERR.needsChoice, skin.file.name);
    } else {
      groups = defaultSelection(plan);
    }

    let laid: string[];
    try {
      laid = await layBanks(zip, plan, groups, dest, opts);
    } catch (e) {
      await fs.rm(zipPath, { force: true });
      throw e;
    }
    if (laid.length === 0) {
      await fs.rm(zipPath, { force: true });
      fail(ERR.emptyArchive);
    }

    // Une banque déjà posée par un autre mod actif vient d'être recouverte.
    // Ça ne se voit pas autrement, donc ça se dit.
    const covered = activeSounds(config, skin.lang_group).filter((r) =>
      soundMeta(r).files.some((f) => laid.some((l) => l.toLowerCase() === f.toLowerCase()))
    );

    const addedEnableMod = await setEnableMod(config, true);

    const meta: SoundMeta = {
      files: laid,
      groups,
      active: true,
      activatedAt: Date.now(),
      addedEnableMod,
      overwrites: covered.map((r) => r.name),
      zip: zipPath,
      provides: soundEntriesFor(plan, groups).map((e) => targetName(plan, e)),
    };

    return {
      contentType: "sound",
      lang_group: skin.lang_group,
      // Les banques sont posées à plat dans un dossier partagé avec les autres
      // mods son : on suit chaque fichier, jamais le dossier.
      path: dest,
      name: safeFolderName(opts?.folderName?.trim() || suggestedName(skin)),
      installedAt: Date.now(),
      snapshot: skin,
      fingerprint: fingerprint(skin),
      refreshedAt: Date.now(),
      meta: meta as unknown as Record<string, unknown>,
    };
  },

  /**
   * Pose ou retire les banques sans toucher à l'archive conservée. C'est ce qui
   * distingue « téléchargé, inactif » de « pas téléchargé ».
   */
  async setActive(record, active, config, opts) {
    const meta = soundMeta(record);
    if (meta.active === active) return record;

    if (!active) {
      await deactivateSound(record, config);
      return { ...record, meta: { ...meta, active: false } as unknown as Record<string, unknown> };
    }

    const dest = await this.resolveDestination(config);
    await fs.mkdir(dest, { recursive: true });

    const zip = new AdmZip(meta.zip);
    const plan = planSoundLayout(
      zip.getEntries().map((e) => e.entryName),
      await readStockBanks(config)
    );
    if (!plan) fail(ERR.emptyArchive);

    const laid = await layBanks(zip, plan, meta.groups, dest, opts);
    if (laid.length === 0) fail(ERR.emptyArchive);

    const covered = activeSounds(config, record.lang_group).filter((r) =>
      soundMeta(r).files.some((f) => laid.some((l) => l.toLowerCase() === f.toLowerCase()))
    );
    const addedEnableMod = (await setEnableMod(config, true)) || meta.addedEnableMod;

    const next: SoundMeta = {
      ...meta,
      files: laid,
      active: true,
      activatedAt: Date.now(),
      addedEnableMod,
      overwrites: covered.map((r) => r.name),
    };
    return { ...record, meta: next as unknown as Record<string, unknown> };
  },

  /**
   * Désinstaller efface tout : les banques posées ET l'archive. Le contrat est
   * qu'une désinstallation ne laisse rien derrière elle.
   */
  async uninstall(record, config) {
    const meta = soundMeta(record);
    if (meta?.active) await deactivateSound(record, config);
    if (meta?.zip) await fs.rm(meta.zip, { force: true });
  },
};

// ------------------------- Registre des installers ------------------------- //
// Enregistrer ici chaque type supporté. Restent à brancher : location,
// model, controls. Aucun des trois n'a de destination connue à ce jour.
export const installers: Partial<Record<ContentType, Installer>> = {
  camouflage: camouflageInstaller,
  sight: sightInstaller,
  sound: soundInstaller,
};

export function getInstaller(content: ContentType): Installer {
  const inst = installers[assertContentType(content)];
  if (!inst) fail(ERR.noInstaller, content);
  return inst;
}
