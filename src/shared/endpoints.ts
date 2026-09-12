/**
 * Manifeste de la surface externe.
 *
 * Toute adresse, tout en-tête, tout motif d'extraction et toute limite qui
 * concerne le monde extérieur est déclaré ICI et nulle part ailleurs. Le reste
 * du code ne connaît que des noms — `feed`, `post`, `vehicleFont` — jamais une
 * URL en dur.
 *
 * L'intérêt est concret : l'API de Live n'est pas officielle. Le jour où elle
 * bouge, la réparation est une modification de données, pas de code — et elle
 * peut se faire sans recompiler, en déposant un fichier de remplacement à côté
 * de la configuration.
 *
 * Ce module est pur et sans dépendance : le main l'utilise pour appeler, le
 * renderer pour construire ses liens, et les tests pour vérifier sa cohérence.
 */

export interface Endpoints {
  /** Incrémenté à chaque changement de forme, pour repérer un fichier périmé. */
  version: number;
  base: string;
  /** Ces en-têtes ne sont pas décoratifs : sans eux l'API répond en erreur. */
  headers: Record<string, string>;
  api: {
    feed: string;
    head: string;
    post: string;
    user: string;
  };
  /** `get_head` renvoie du HTML : la taxonomie est extraite au motif. */
  filtersPattern: string;
  /** Hôtes autorisés à servir une archive, redirections comprises. */
  downloadHosts: string[];
  /** Hôtes reconnus comme appartenant à Live, pour les liens entrants. */
  siteHosts: string[];
  vehicleFont: string;
  /**
   * Serveur HTTP que le jeu ouvre sur la machine locale.
   *
   * Gaijin le fournit pour les outils tiers (cartes, télémétrie). Il donne
   * le véhicule courant à l'instant près, hangar compris, là où le fichier
   * de profil ne s'écrit qu'épisodiquement. Rien n'y est envoyé : une
   * requête GET, et jamais un contact avec le processus du jeu.
   */
  gameApi: string;
  /** Gabarits de pages publiques. `{value}` est remplacé, jamais concaténé. */
  pages: {
    post: string;
    user: string;
    tag: string;
  };
  limits: {
    maxDownloadBytes: number;
    maxExtractedBytes: number;
    maxEntries: number;
    idleMs: number;
    maxRedirects: number;
    /** Délai d'attente d'un appel d'API, hors téléchargement d'archive. */
    apiTimeoutMs: number;
    /** Réessais après un échec réseau ou une erreur serveur. */
    retries: number;
    /** Attente avant le premier réessai ; elle double ensuite. */
    retryBaseMs: number;
  };
}

export const DEFAULT_ENDPOINTS: Endpoints = {
  version: 1,
  base: "https://live.warthunder.com",
  headers: {
    "User-Agent":
      "Mozilla/5.0 (X11; Linux x86_64; rv:150.0) Gecko/20100101 Firefox/150.0",
    Origin: "https://live.warthunder.com",
    Referer: "https://live.warthunder.com/feed/all/",
    "Content-Type": "application/x-www-form-urlencoded",
  },
  api: {
    feed: "/api/feed/get_regular/",
    head: "/api/feed/get_head/",
    post: "/api/posts/get/",
    user: "/api/feed/get_user/",
  },
  filtersPattern: "const filters = (\\{[\\s\\S]*?\\});",
  downloadHosts: ["live.warthunder.com", "cdn-live.warthunder.com"],
  siteHosts: ["live.warthunder.com", "www.live.warthunder.com"],
  vehicleFont: "/fonts/symbols_skyquake_short.woff2",
  gameApi: "http://127.0.0.1:8111",
  pages: {
    post: "https://live.warthunder.com/post/{id}/",
    user: "https://live.warthunder.com/user/{name}/",
    tag: "https://live.warthunder.com/?q=%23{tag}",
  },
  limits: {
    // 1 Go : les mods son montent à 853 Mo (ETSMIV), contre 90 Mo pour le plus
    // gros camouflage. L'archive n'est plus tamponnée en mémoire depuis qu'elle
    // s'écrit au fil de l'eau, ce plafond ne protège plus que le disque.
    maxDownloadBytes: 1024 * 1024 * 1024,
    maxExtractedBytes: 2 * 1024 * 1024 * 1024,
    maxEntries: 20_000,
    idleMs: 60_000,
    maxRedirects: 5,
    apiTimeoutMs: 15_000,
    // Deux réessais, pas plus : l'API n'est pas officielle, insister serait
    // impoli et ne réparerait pas une panne durable.
    retries: 2,
    retryBaseMs: 700,
  },
};

/** Remplit un gabarit. Les valeurs sont encodées : elles viennent de l'API. */
export function fillTemplate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name) =>
    Object.hasOwn(vars, name) ? encodeURIComponent(String(vars[name])) : whole
  );
}

function isHttpsUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  try {
    return new URL(v).protocol === "https:";
  } catch {
    return false;
  }
}

const isHost = (v: unknown): v is string =>
  typeof v === "string" && /^[a-z0-9.-]{3,253}$/i.test(v) && v.includes(".");

const isPath = (v: unknown): v is string => typeof v === "string" && v.startsWith("/") && v.length < 512;

/**
 * Fusionne un remplacement partiel avec les valeurs par défaut.
 *
 * Chaque champ est vérifié séparément : un fichier à moitié faux ne doit pas
 * emporter les champs valides avec lui. Un champ rejeté garde silencieusement
 * sa valeur d'origine — l'application reste fonctionnelle, ce qui est le but.
 *
 * Contrôle important : les hôtes de téléchargement restent modifiables, sinon
 * le manifeste ne servirait à rien le jour où Live déménage. Mais un
 * remplacement ne peut introduire que des noms d'hôtes plausibles, et toutes
 * les URL doivent rester en https.
 */
export function mergeEndpoints(override: unknown, base: Endpoints = DEFAULT_ENDPOINTS): Endpoints {
  if (!override || typeof override !== "object") return base;
  const o = override as Record<string, any>;
  const out: Endpoints = structuredClone(base);

  if (isHttpsUrl(o.base)) out.base = o.base.replace(/\/+$/, "");

  if (o.headers && typeof o.headers === "object") {
    for (const [k, v] of Object.entries(o.headers)) {
      if (/^[\w-]{1,64}$/.test(k) && typeof v === "string" && v.length < 512) out.headers[k] = v;
    }
  }

  for (const key of ["feed", "head", "post", "user"] as const) {
    if (isPath(o.api?.[key])) out.api[key] = o.api[key];
  }

  if (typeof o.filtersPattern === "string" && o.filtersPattern.length < 512) {
    // Un motif invalide ferait planter chaque appel : on l'essaie d'abord.
    try {
      new RegExp(o.filtersPattern);
      out.filtersPattern = o.filtersPattern;
    } catch {
      /* on garde le motif d'origine */
    }
  }

  for (const key of ["downloadHosts", "siteHosts"] as const) {
    const list = o[key];
    if (Array.isArray(list) && list.length > 0 && list.length <= 16 && list.every(isHost)) {
      out[key] = list.map((h: string) => h.toLowerCase());
    }
  }

  if (isPath(o.vehicleFont)) out.vehicleFont = o.vehicleFont;

  // Le serveur du jeu est local par nature : on n'accepte qu'une boucle
  // locale, sinon le manifeste deviendrait un moyen de faire interroger
  // une machine tierce depuis le poste du joueur.
  if (typeof o.gameApi === "string" && /^http:\/\/(127\.0\.0\.1|localhost)(:\d{1,5})?$/.test(o.gameApi)) {
    out.gameApi = o.gameApi;
  }

  for (const key of ["post", "user", "tag"] as const) {
    if (isHttpsUrl(o.pages?.[key])) out.pages[key] = o.pages[key];
  }

  if (o.limits && typeof o.limits === "object") {
    for (const [k, v] of Object.entries(o.limits)) {
      if (k in out.limits && typeof v === "number" && Number.isFinite(v) && v > 0) {
        (out.limits as Record<string, number>)[k] = v;
      }
    }
  }

  return out;
}
