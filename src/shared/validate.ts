/**
 * Validation des données qui franchissent la frontière IPC.
 *
 * TypeScript disparaît à l'exécution : annoter `(_e, dir: string)` ne garantit
 * rien. Ces fonctions sont la seule vérification réelle de ce que le renderer
 * envoie au main. Elles sont pures et sans dépendance, donc testables sans
 * lancer Electron — c'est tout l'intérêt de les sortir des handlers.
 *
 * Principe : on ne « corrige » pas une entrée douteuse, on la rejette. Une
 * valeur silencieusement remplacée produit un comportement qui ressemble à un
 * bug de données au lieu d'une erreur.
 */

import { ERR, fail } from "./errors.js";

export function asString(v: unknown, max = 4096): string {
  if (typeof v !== "string") fail(ERR.badArgs, `attendu string, reçu ${typeof v}`);
  if (v.length > max) fail(ERR.badArgs, `chaîne de ${v.length} caractères`);
  return v;
}

export function asIndex(v: unknown, max = 1_000_000): number {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isInteger(n) || n < 0 || n > max) fail(ERR.badArgs, `entier attendu, reçu ${String(v)}`);
  return n;
}

export function asOneOf<T extends string>(v: unknown, allowed: readonly T[]): T {
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    fail(ERR.badArgs, `valeur inattendue : ${String(v)}`);
  }
  return v as T;
}

/**
 * Paramètres de recherche. Tout ce qui n'est pas listé ici est jeté : sans ce
 * filtrage, le renderer pourrait injecter des champs arbitraires dans le corps
 * de la requête envoyée à Live.
 */
const SEARCH_FIELDS = [
  "vehicleCountry",
  "vehicleType",
  "vehicleClass",
  "vehicle",
  "searchString",
] as const;

export interface CleanSearch {
  content?: string;
  sort?: string;
  page?: number;
  vehicleCountry?: string;
  vehicleType?: string;
  vehicleClass?: string;
  vehicle?: string;
  searchString?: string;
}

export function asSearchParams(v: unknown): CleanSearch {
  if (!v || typeof v !== "object") fail(ERR.badArgs, "paramètres de recherche absents");
  const src = v as Record<string, unknown>;
  const out: CleanSearch = {};

  if (src.content !== undefined) out.content = asString(src.content, 32);
  if (src.sort !== undefined) out.sort = asString(src.sort, 32);
  if (src.page !== undefined) out.page = asIndex(src.page, 10_000);
  for (const key of SEARCH_FIELDS) {
    if (src[key] !== undefined) out[key] = asString(src[key], 128);
  }
  return out;
}

export interface CleanUserPage {
  user: number;
  content?: string;
  sort?: string;
  page?: number;
}

export function asUserPage(v: unknown): CleanUserPage {
  if (!v || typeof v !== "object") fail(ERR.badArgs, "paramètres d'auteur absents");
  const src = v as Record<string, unknown>;
  const out: CleanUserPage = { user: asIndex(src.user, 100_000_000) };
  if (src.content !== undefined) out.content = asString(src.content, 32);
  if (src.sort !== undefined) out.sort = asString(src.sort, 32);
  if (src.page !== undefined) out.page = asIndex(src.page, 10_000);
  return out;
}

/**
 * Le contenu à installer, réduit aux champs dont on a réellement besoin.
 *
 * Le renderer envoyait jusqu'ici l'objet complet, qui finissait persisté tel
 * quel dans config.json : n'importe quelle propriété supplémentaire, de
 * n'importe quelle taille, se retrouvait sur le disque et était relue au
 * démarrage suivant. On reconstruit un objet propre à partir d'une liste
 * fermée — c'est le même réflexe que pour une écriture en base.
 */
export interface CleanSkin {
  id: number;
  lang_group: number;
  likes: number;
  views: number;
  downloads: number;
  comments: number;
  created: number;
  type: string;
  description: string;
  author: { id: number; nickname: string; avatar: string };
  images: Array<{ src?: string; orig?: { src: string } }>;
  file: { name: string; link: string; size: number };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown, max: number): string =>
  typeof v === "string" ? v.slice(0, max) : "";

export function asSkin(v: unknown): CleanSkin {
  if (!v || typeof v !== "object") fail(ERR.badArgs, "contenu absent");
  const s = v as Record<string, any>;

  if (!s.file || typeof s.file.link !== "string") fail(ERR.badArgs, "file.link manquant");

  return {
    id: asIndex(s.id, 100_000_000),
    lang_group: asIndex(s.lang_group, 100_000_000),
    likes: num(s.likes),
    views: num(s.views),
    downloads: num(s.downloads),
    comments: num(s.comments),
    created: num(s.created),
    type: str(s.type, 32),
    // La description est du HTML d'auteur : bornée, car elle est persistée.
    description: str(s.description, 8_000),
    author: {
      id: asIndex(s.author?.id ?? 0, 100_000_000),
      nickname: str(s.author?.nickname, 128),
      avatar: str(s.author?.avatar, 512),
    },
    // 12 images : le maximum observé sur Live est de 9, et cet objet finit
    // persisté — chaque URL conservée pèse dans config.json.
    images: Array.isArray(s.images)
      ? s.images.slice(0, 12).map((i: any) => ({
          src: typeof i?.src === "string" ? i.src.slice(0, 512) : undefined,
          orig: typeof i?.orig?.src === "string" ? { src: i.orig.src.slice(0, 512) } : undefined,
        }))
      : [],
    file: {
      name: str(s.file.name, 256),
      link: str(s.file.link, 512),
      size: num(s.file.size),
    },
  };
}

/** Un auteur mis en favori, réduit à ce qu'on affiche. Persisté, donc borné. */
export function asAuthorRef(v: unknown): { id: number; nickname: string; avatar: string } {
  if (!v || typeof v !== "object") fail(ERR.badArgs, "auteur absent");
  const a = v as Record<string, unknown>;
  return {
    id: asIndex(a.id, 100_000_000),
    nickname: str(a.nickname, 128),
    avatar: str(a.avatar, 512),
  };
}

/** Un enregistrement d'installation ne sert qu'à DÉSIGNER quoi retirer. */
export function asRecordRef(v: unknown): { contentType: string; lang_group: number } {
  if (!v || typeof v !== "object") fail(ERR.badArgs, "enregistrement absent");
  const r = v as Record<string, unknown>;
  return {
    contentType: asString(r.contentType, 32),
    lang_group: asIndex(r.lang_group, 100_000_000),
  };
}
