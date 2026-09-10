/**
 * Surface typée du pont preload. Les types viennent du main via `import type`,
 * donc entièrement effacés à la compilation : aucun code du main (ni fs, ni
 * adm-zip) n'atterrit dans le bundle du renderer.
 */

import type {
  ContentType,
  InstalledRecord,
  Page,
  SearchParams,
  Skin,
  SortKey,
} from "../../main/wtLive.js";
import type { FavoriteAuthor, ValidationResult, WtConfigFile } from "../../main/config.js";

export type { ContentType, FavoriteAuthor, InstalledRecord, Page, SearchParams, Skin, SortKey, WtConfigFile };
export type { DeepLink } from "../../shared/deepLink.js";
import { DEFAULT_ENDPOINTS, fillTemplate } from "../../shared/endpoints.js";

// Les 4 options du menu de tri de live.warthunder.com, dans son ordre.
export const SORTS: Array<{ value: SortKey; key: "sortPopular" | "sortRecent" | "sortDownloads" | "sortComments" }> = [
  { value: "rating", key: "sortPopular" },
  { value: "created", key: "sortRecent" },
  { value: "downloads", key: "sortDownloads" },
  { value: "comments", key: "sortComments" },
];

export interface FilterVariant {
  value?: string;
  name: string;
  count?: number;
  separator?: boolean;
  dep?: Record<string, string[]>;
}

export interface FilterType {
  placeholder: string;
  variants: FilterVariant[];
}

export type Taxonomy = Record<string, FilterType>;

export type PickResult = ValidationResult & { canceled?: boolean };

interface Api {
  config: {
    get(): Promise<WtConfigFile>;
    detect(): Promise<string | null>;
    validate(dir: string): Promise<ValidationResult>;
    pick(labels: { title: string; buttonLabel: string }): Promise<PickResult>;
    setGameDir(dir: string): Promise<ValidationResult>;
    toggleFavorite(author: { id: number; nickname: string; avatar: string }): Promise<FavoriteAuthor[]>;
  };
  content: {
    search(params: SearchParams): Promise<Page>;
    filters(content: ContentType): Promise<Taxonomy>;
    post(langGroup: number): Promise<Skin>;
    userPage(params: {
      user: number;
      content: ContentType;
      sort?: SortKey;
      page?: number;
    }): Promise<Page>;
    install(
      content: ContentType,
      skin: Skin,
      folderName?: string,
      groups?: string[]
    ): Promise<InstalledRecord>;
    uninstall(record: InstalledRecord): Promise<void>;
    inspect(skin: Skin): Promise<ArchiveChoice | null>;
    setActive(record: InstalledRecord, active: boolean): Promise<InstalledRecord>;
    cancelInstall(id: number): Promise<boolean>;
    refreshInstalled(): Promise<InstalledRecord[]>;
    foreign(): Promise<ForeignFolder[]>;
    onProgress(cb: (p: Progress) => void): () => void;
  };
  vehicleFont(): Promise<string | null>;
  openSkinsFolder(): Promise<void>;
  openExternal(url: string): Promise<void>;
  copy(text: string): Promise<void>;
  takeLink(): Promise<DeepLinkValue | null>;
  endpoints(): Promise<{ pages: { post: string; user: string; tag: string }; siteHosts: string[] }>;
  onDeepLink(cb: (link: DeepLinkValue) => void): () => void;
}

type DeepLinkValue =
  | { kind: "post"; langGroup: number }
  | { kind: "author"; nickname: string }
  | { kind: "tag"; tag: string };

/**
 * Ce qu'une archive propose comme dossiers, lu avant le téléchargement.
 *
 * `needsChoice` distingue les deux formes : des dossiers qui s'additionnent
 * (cases à cocher, tout coché) et des dossiers qui posent les mêmes fichiers,
 * donc s'excluent (un seul retenu par famille).
 */
export interface ArchiveChoice {
  needsChoice: boolean;
  /** `files` porte les noms d'ARRIVÉE, ceux qui atterriront dans `sound/mod`. */
  groups: Array<{ dir: string; count: number; files: string[]; clashesWith: string[] }>;
  /** Sélection de départ : les additifs, plus un de chaque famille exclusive. */
  selected: string[];
}

/**
 * Ce qu'un mod son porte en plus des autres types.
 *
 * Il a un état que les autres n'ont pas : téléchargé sans être posé dans le
 * jeu. Le main en est la seule source — ces champs viennent de config.json et
 * ne sont jamais fabriqués ici.
 */
export interface SoundMeta {
  /** Banques posées dans `sound/mod`, sans dossier. */
  files: string[];
  /** Dossiers de l'archive retenus à l'installation. */
  groups: string[];
  active: boolean;
  activatedAt: number;
  /** Mods dont celui-ci a recouvert au moins une banque. */
  overwrites: string[];
}

export function soundMeta(record: InstalledRecord): SoundMeta | null {
  if (record.contentType !== "sound" || !record.meta) return null;
  return record.meta as unknown as SoundMeta;
}

/** Un mod son posé dans le jeu, par opposition à simplement téléchargé. */
export const isActive = (record: InstalledRecord): boolean => soundMeta(record)?.active === true;

/** Ce qu'un mod son actif perdrait si `files` était posé par-dessus. */
export interface Covered {
  name: string;
  /** Toutes ses banques sont recouvertes : il ne jouerait plus rien du tout. */
  total: boolean;
}

/**
 * Mods son actifs qu'une pose de `files` recouvrirait.
 *
 * Le jeu ne lit qu'un fichier par nom dans `sound/mod` : poser
 * `masterbank.bank` par-dessus celui d'un autre mod le remplace. L'autre reste
 * actif pour ses banques restantes, sauf si on les prend toutes — auquel cas il
 * ne joue plus rien, et le dire « remplace quelques sons » serait mentir.
 *
 * Sert avant l'action, dans la boîte d'installation et sur le bouton d'activation.
 */
export function coveredBy(
  files: string[],
  installed: InstalledRecord[],
  exceptGroup?: number
): Covered[] {
  const laid = new Set(files.map((f) => f.toLowerCase()));
  const out: Covered[] = [];

  for (const record of installed) {
    if (record.lang_group === exceptGroup || !isActive(record)) continue;
    const theirs = soundMeta(record)?.files ?? [];
    if (theirs.length === 0) continue;
    const hit = theirs.filter((f) => laid.has(f.toLowerCase()));
    if (hit.length > 0) out.push({ name: record.name, total: hit.length === theirs.length });
  }
  return out;
}

export interface ForeignFolder {
  name: string;
  path: string;
  modifiedAt: number;
}

/**
 * Un contenu a-t-il été republié depuis son installation ? On compare
 * l'empreinte posée sur le disque à celle de l'instantané rafraîchi.
 */
export function hasUpdate(record: InstalledRecord): boolean {
  if (!record.fingerprint || !record.snapshot) return false;
  const fresh = `${record.snapshot.id}:${record.snapshot.file.size}:${record.snapshot.file.name}`;
  return fresh !== record.fingerprint;
}

export interface Progress {
  id: number; // skin.id du contenu en cours
  phase: "download" | "extract";
  loaded: number;
  total: number;
}

// `globalThis` plutôt que `window` : les helpers pures de ce fichier sont
// testés sous Node, où window n'existe pas et où une lecture directe planterait
// au chargement du module.
export const api: Api = (globalThis as unknown as { window?: { api: Api } }).window?.api as Api;

export type FilterKey = "vehicleCountry" | "vehicleType" | "vehicleClass" | "vehicle";
export const FILTER_KEYS: readonly FilterKey[] = [
  "vehicleCountry",
  "vehicleType",
  "vehicleClass",
  "vehicle",
];
export type Selection = Partial<Record<FilterKey, string>>;

export interface Option {
  display: string; // ce que l'utilisateur voit et tape
  value: string; // ce qu'on envoie à Live
  group: string; // le `separator` qui précède (pays, ou catégorie) — "" si aucun
}

/**
 * Gaijin préfixe certains véhicules d'un marqueur (importé, prime, événement) :
 * `▄M44`, `◘AH-64D` pour la France, `␗A6M2` pour la Chine. Ces marqueurs
 * comptent — `▄M44` recouvre à lui seul uk_m44, fr_m44 et it_m44 — donc on les
 * garde et c'est la pile de polices qui doit les dessiner.
 *
 * Sauf ceux de la zone privée Unicode (U+E000–U+F8FF, dont U+F059 côté Israël) :
 * ils n'ont de glyphe que dans la police maison de Gaijin, et s'afficheraient
 * partout ailleurs en carré vide. Ceux-là, on les retire.
 */
export function cleanName(name: string): string {
  let out = "";
  for (const ch of name) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xe000 && cp <= 0xf8ff) continue; // zone privée : jamais dessinable
    out += ch;
  }
  return out.replace(/\s+/g, " ").trim();
}

/**
 * Une variante s'affiche si chaque clé de son `dep` est satisfaite par la
 * sélection courante. Une clé non sélectionnée ne contraint rien — sinon
 * choisir un type sans pays viderait la liste des véhicules.
 */
export function visible(v: FilterVariant, sel: Selection): boolean {
  if (!v.dep) return true;
  return Object.entries(v.dep).every(([key, allowed]) => {
    const chosen = sel[key as FilterKey];
    return !chosen || allowed.includes(chosen);
  });
}

/**
 * Construit les options d'un filtre : cascade appliquée, groupées par
 * `separator` (pays pour les véhicules, catégorie pour les classes), triées
 * par groupe puis alphabétiquement à l'intérieur.
 *
 * Les noms ne sont PAS rendus globalement uniques : l'en-tête de groupe
 * distingue déjà « M1A1 » britannique de l'américain. Seuls les doublons à
 * l'intérieur d'un même groupe sont suffixés de leur valeur brute — « Mark V »
 * apparaît deux fois sous Great Britain, l'en-tête n'y peut rien.
 */
export function buildOptions(variants: FilterVariant[], sel: Selection): Option[] {
  let group = "";
  const rows: Option[] = [];
  for (const v of variants) {
    // Les séparateurs pilotent le groupe courant même masqués par la cascade,
    // pour que l'en-tête suive toujours la dernière section rencontrée.
    if (v.separator) {
      group = cleanName(v.name);
      continue;
    }
    if (!visible(v, sel)) continue;
    if (!v.value || v.value === "any") continue;
    rows.push({ display: cleanName(v.name), value: v.value, group });
  }

  const perGroup = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const counts = perGroup.get(r.group) ?? new Map<string, number>();
    counts.set(r.display, (counts.get(r.display) ?? 0) + 1);
    perGroup.set(r.group, counts);
  }

  return rows
    .map((r) =>
      (perGroup.get(r.group)?.get(r.display) ?? 0) > 1
        ? { ...r, display: `${r.display} (${r.value})` }
        : r
    )
    .sort(
      (a, b) =>
        a.group.localeCompare(b.group, "fr") ||
        a.display.localeCompare(b.display, "fr", { numeric: true })
    );
}

// Les items de Live n'ont pas de titre : le nom de l'archive fait office
// d'étiquette, une fois débarrassé de son extension.
export function skinLabel(skin: Skin): string {
  return skin.file.name.replace(/\.zip$/i, "");
}

export function thumbnail(skin: Skin): string {
  const img = skin.images[0];
  return img?.src ?? img?.orig?.src ?? "";
}

// Les hashtags sont noyés dans le HTML de `description` : c'est la seule source.
// On extrait du texte, jamais de HTML injecté dans le DOM.
export function tagsOf(skin: Skin): string[] {
  const out = new Set<string>();
  const re = /class="WTL-Embed-Hashtag"[^>]*>\s*#?([^<]+?)\s*</g;
  for (const m of (skin.description ?? "").matchAll(re)) {
    const t = m[1].trim().toLowerCase();
    if (t) out.add(t);
  }
  return [...out];
}

/**
 * La liste ne renvoie que des vignettes `_lq` (≈386px), trop petites pour une
 * galerie. Les URLs `_mq` (800px) s'en déduisent : vérifié sur 27 images de 16
 * skins, aucun écart. Comme c'est une convention de CDN non documentée, l'appelant
 * garde l'URL `_lq` en repli via onError — au pire on réaffiche ce qu'on avait.
 * Ça évite un appel posts/get par ouverture de fiche.
 */
export function hiRes(url: string): string {
  return url.includes("_lq/") ? url.replace("_lq/", "_mq/") : url;
}

export function imagesOf(skin: Skin): string[] {
  return skin.images.map((i) => i.src ?? i.orig?.src ?? "").filter(Boolean);
}

// Table Latin-1 + ponctuation courante. La recherche est SENSIBLE À LA CASSE :
// &Eacute; et &eacute; ne donnent pas la même lettre.
const ENTITIES: Record<string, string> = Object.assign(
  // nbsp à part : sa valeur est une espace, elle ne survivrait pas au split.
  { nbsp: " " },
  Object.fromEntries(
  (
    "amp=& lt=< gt=> quot=\" apos=' hellip=… mdash=— ndash=– " +
    "rsquo=’ lsquo=‘ ldquo=“ rdquo=” laquo=« raquo=» bull=• middot=· deg=° " +
    "copy=© reg=® trade=™ euro=€ pound=£ yen=¥ cent=¢ sect=§ para=¶ " +
    "times=× divide=÷ plusmn=± frac12=½ frac14=¼ sup2=² sup3=³ " +
    "Agrave=À agrave=à Aacute=Á aacute=á Acirc=Â acirc=â Atilde=Ã atilde=ã " +
    "Auml=Ä auml=ä Aring=Å aring=å AElig=Æ aelig=æ Ccedil=Ç ccedil=ç " +
    "Egrave=È egrave=è Eacute=É eacute=é Ecirc=Ê ecirc=ê Euml=Ë euml=ë " +
    "Igrave=Ì igrave=ì Iacute=Í iacute=í Icirc=Î icirc=î Iuml=Ï iuml=ï " +
    "Ntilde=Ñ ntilde=ñ Ograve=Ò ograve=ò Oacute=Ó oacute=ó Ocirc=Ô ocirc=ô " +
    "Otilde=Õ otilde=õ Ouml=Ö ouml=ö Oslash=Ø oslash=ø " +
    "Ugrave=Ù ugrave=ù Uacute=Ú uacute=ú Ucirc=Û ucirc=û Uuml=Ü uuml=ü " +
    "Yacute=Ý yacute=ý yuml=ÿ szlig=ß"
  )
    .split(" ")
    .filter(Boolean)
    .map((pair) => {
      const i = pair.indexOf("=");
      return [pair.slice(0, i), pair.slice(i + 1)];
    })
  )
);

/**
 * `description` est du HTML écrit par les auteurs. On le convertit en texte et
 * on l'affiche via React, qui échappe : jamais de dangerouslySetInnerHTML sur
 * du contenu distant. Les sauts de ligne sont préservés, les liens réduits à
 * leur texte.
 */
export function plainText(html: string): string {
  return (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => ENTITIES[name] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}


/**
 * Gabarits de pages publiques, reçus du main au démarrage.
 *
 * Le renderer ne fabrique plus d'URL à la main : elle vient du même manifeste
 * que les appels sortants. Une seule source de vérité pour l'extérieur.
 */
let pages = DEFAULT_ENDPOINTS.pages;

export function setPages(next: typeof pages): void {
  pages = next;
}

/**
 * Page publique d'un contenu.
 *
 * L'identifiant est `lang_group`, PAS `id` : `id` designe la variante de langue
 * et /post/<id>/ tombe sur un tout autre contenu (verifie — /post/249822/ menait
 * a une image d'un autre auteur, /post/240523/ au bon camouflage).
 */
export function liveUrl(skin: Skin): string {
  return fillTemplate(pages.post, { id: skin.lang_group });
}

export function authorUrl(nickname: string): string {
  return fillTemplate(pages.user, { name: nickname });
}

/**
 * Nom de dossier proposé dans la boîte d'installation. Ce n'est qu'une
 * suggestion d'affichage : le main réassainit systématiquement avec
 * safeFolderName avant d'écrire quoi que ce soit sur le disque.
 */
export function suggestName(skin: Skin): string {
  return skin.file.name
    .replace(/\.zip$/i, "")
    .replace(/[<>:"|?*\\/]/g, "_")
    .replace(/[. ]+$/, "")
    .trim()
    .slice(0, 120);
}

/**
 * Formateurs localisés. `Intl` gère l'unité, le séparateur décimal et la
 * notation compacte pour chaque langue — le faire à la main serait faux quelque
 * part. Les instances sont mises en cache : en construire une par carte coûte
 * cher sur une grille de plusieurs centaines d'éléments.
 */
const sizeFmt = new Map<string, Intl.NumberFormat>();
const countFmt = new Map<string, Intl.NumberFormat>();
const dateFmt = new Map<string, Intl.DateTimeFormat>();

function cached<T>(store: Map<string, T>, key: string, make: () => T): T {
  let hit = store.get(key);
  if (!hit) {
    hit = make();
    store.set(key, hit);
  }
  return hit;
}

export interface TextPart {
  text: string;
  /** Lien externe — passe par la confirmation de sortie d'application. */
  href?: string;
  /** Hashtag — relance une recherche DANS l'app, sans sortir. */
  tag?: string;
}

/**
 * Reconnaît une URL de recherche par hashtag de Live (`?q=%23winter`).
 *
 * Les descriptions contiennent deux formes : l'ancre balisée `WTL-Embed-Hashtag`
 * que le site génère, et des liens écrits à la main vers la même recherche. La
 * seconde partait vers le navigateur, ce qui n'a aucun sens — on sait faire
 * cette recherche nous-mêmes.
 */
export function hashtagOf(raw: string): string | undefined {
  try {
    const u = new URL(raw, "https://live.warthunder.com");
    if (!/(^|\.)warthunder\.com$/.test(u.hostname)) return undefined;
    const q = u.searchParams.get("q") ?? "";
    const m = q.match(/^#(.+)$/);
    return m ? m[1].trim().toLowerCase() || undefined : undefined;
  } catch {
    return undefined;
  }
}

// Seuls http(s) deviennent cliquables. Un `javascript:` ou un `file:` glissé
// dans une description ne doit même pas ressembler à un lien — le main le
// refuserait, mais autant ne pas l'offrir.
function safeHref(raw: string): string | undefined {
  try {
    const u = new URL(raw, "https://live.warthunder.com");
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : undefined;
  } catch {
    return undefined;
  }
}

const INLINE = /\bhttps?:\/\/[^\s<>"')\]]+|(?<![\w#])#[\p{L}\d_]{2,40}/gu;

/**
 * Description découpée en segments, les liens isolés des textes.
 *
 * Les hashtags sont retirés : ils sont déjà rendus en pastilles cliquables
 * au-dessus. Les ancres restantes gardent leur destination, et les URLs écrites
 * en clair dans le texte deviennent cliquables aussi — c'est fréquent dans les
 * descriptions de Live, qui renvoient vers des dépôts ou des vidéos.
 *
 * Rien n'est injecté en HTML : chaque segment est rendu comme du texte par
 * React, et les liens passent par la confirmation de sortie d'application.
 */
export function descriptionParts(skin: Skin): TextPart[] {
  const html = (skin.description ?? "").replace(
    /<a[^>]*class="WTL-Embed-Hashtag"[^>]*>[\s\S]*?<\/a>/g,
    ""
  );

  const parts: TextPart[] = [];
  const anchor = /<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let cursor = 0;

  const pushText = (chunk: string) => {
    const text = plainText(chunk);
    if (!text) return;
    // Les URLs et les #hashtags ecrits en clair deviennent cliquables : les
    // premieres sortent vers le navigateur apres confirmation, les seconds
    // relancent une recherche dans l'app.
    let last = 0;
    for (const m of text.matchAll(INLINE)) {
      const at = m.index ?? 0;
      if (at > last) parts.push({ text: text.slice(last, at) });
      // La ponctuation finale appartient a la phrase, pas a l'URL : sans ce
      // retrait, "voir https://x/y." produisait un lien vers "y.".
      const token = m[0].replace(/[.,;:!?]+$/, "");
      if (!token) { last = at + m[0].length; continue; }
      if (token.startsWith("#")) parts.push({ text: token, tag: token.slice(1).toLowerCase() });
      else parts.push({ text: token, href: safeHref(token) });
      last = at + token.length;
    }
    if (last < text.length) parts.push({ text: text.slice(last) });
  };

  for (const m of html.matchAll(anchor)) {
    const at = m.index ?? 0;
    if (at > cursor) pushText(html.slice(cursor, at));
    const label = plainText(m[2]) || m[1];
    const tag = hashtagOf(m[1]);
    parts.push(tag ? { text: label, tag } : { text: label, href: safeHref(m[1]) });
    cursor = at + m[0].length;
  }
  if (cursor < html.length) pushText(html.slice(cursor));

  return parts.filter((p) => p.text.trim().length > 0);
}

/** Version texte seule, quand les liens ne servent à rien. */
export function descriptionText(skin: Skin): string {
  return descriptionParts(skin)
    .map((p) => p.text)
    .join("");
}

export function formatSize(bytes: number, locale = "en"): string {
  const mb = bytes >= 1024 * 1024;
  const value = mb ? bytes / 1024 / 1024 : Math.max(1, bytes / 1024);
  return cached(sizeFmt, `${locale}:${mb}`, () =>
    new Intl.NumberFormat(locale, {
      style: "unit",
      unit: mb ? "megabyte" : "kilobyte",
      unitDisplay: "short",
      maximumFractionDigits: mb ? 1 : 0,
    })
  ).format(value);
}

export function formatCount(n: number, locale = "en"): string {
  return cached(countFmt, locale, () =>
    new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 })
  ).format(n);
}

export function formatDate(unixSeconds: number, locale = "en"): string {
  return cached(dateFmt, locale, () =>
    new Intl.DateTimeFormat(locale, { day: "numeric", month: "long", year: "numeric" })
  ).format(new Date(unixSeconds * 1000));
}
