/**
 * Analyse des liens entrants, qu'ils viennent du protocole `wtcm://`, de la
 * ligne de commande ou d'un collage dans l'application.
 *
 * Contrainte système à connaître : une application ne peut pas intercepter les
 * URL `https://live.warthunder.com/...` sans être le navigateur par défaut.
 * D'où deux chemins complémentaires — un protocole maison pour les liens que
 * l'app génère, et la reconnaissance d'une URL Live collée à la main.
 *
 * Module pur, sans dépendance : il est testé sans lancer Electron, et c'est le
 * seul endroit qui décide de ce qu'un lien signifie.
 */

import { DEFAULT_ENDPOINTS, fillTemplate } from "./endpoints.js";

export const SCHEME = "wtcm";

export type DeepLink =
  | { kind: "post"; langGroup: number }
  | { kind: "author"; nickname: string }
  | { kind: "tag"; tag: string };

/**
 * Hôtes reconnus. Paramétrable : si Live déménage, le manifeste change et les
 * liens entrants suivent, sans toucher à cet analyseur.
 */
let siteHosts: string[] = DEFAULT_ENDPOINTS.siteHosts;

export function setSiteHosts(hosts: string[]): void {
  if (hosts.length > 0) siteHosts = hosts.map((h) => h.toLowerCase());
}

/**
 * Accepte trois formes :
 *   https://live.warthunder.com/post/240523/         → contenu
 *   https://live.warthunder.com/user/Kriegsmaler/    → auteur
 *   https://live.warthunder.com/?q=%23winter         → recherche
 * et leurs équivalents `wtcm://` — `wtcm://post/240523`, ou une URL Live
 * complète encapsulée : `wtcm://https://live.warthunder.com/post/240523/`.
 *
 * Renvoie `null` sur tout le reste. Une entrée douteuse ne doit rien déclencher.
 */
export function parseDeepLink(raw: string): DeepLink | null {
  const input = (raw ?? "").trim();
  if (!input) return null;

  // Forme encapsulée : on retire le préfixe et on réanalyse l'URL portée.
  const wrapped = input.match(new RegExp(`^${SCHEME}:(?://)?(https?://.+)$`, "i"));
  if (wrapped) return parseDeepLink(wrapped[1]);

  // Forme courte : wtcm://post/240523, wtcm://user/Nom, wtcm://tag/winter
  const short = input.match(new RegExp(`^${SCHEME}:(?://)?([a-z]+)/([^/?#]+)/?$`, "i"));
  if (short) return fromParts(short[1].toLowerCase(), decodeURIComponent(short[2]));

  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (!siteHosts.includes(url.hostname.toLowerCase())) return null;

  const q = url.searchParams.get("q") ?? "";
  const tagged = q.match(/^#(.+)$/);
  if (tagged) return fromParts("tag", tagged[1]);

  const [section, value] = url.pathname.split("/").filter(Boolean);
  return section && value ? fromParts(section.toLowerCase(), decodeURIComponent(value)) : null;
}

function fromParts(section: string, value: string): DeepLink | null {
  if (section === "post") {
    // L'identifiant d'une page publique est le lang_group, pas l'id de variante.
    const n = Number(value);
    return Number.isInteger(n) && n > 0 && n < 100_000_000 ? { kind: "post", langGroup: n } : null;
  }
  if (section === "user") {
    const nickname = value.slice(0, 128).trim();
    return nickname ? { kind: "author", nickname } : null;
  }
  if (section === "tag") {
    const tag = value.replace(/^#+/, "").slice(0, 64).trim().toLowerCase();
    return tag ? { kind: "tag", tag } : null;
  }
  return null;
}

/** Lien public d'un contenu — celui qu'on partage, il marche pour tout le monde. */
export function shareUrl(langGroup: number, pages = DEFAULT_ENDPOINTS.pages): string {
  return fillTemplate(pages.post, { id: langGroup });
}

/** Lien qui ouvre directement l'application, pour ceux qui l'ont installée. */
export function appUrl(langGroup: number): string {
  return `${SCHEME}://post/${langGroup}`;
}
