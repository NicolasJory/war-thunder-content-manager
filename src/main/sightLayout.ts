/**
 * Analyse la structure d'une archive de viseurs.
 *
 * Un camouflage s'enrobe dans un dossier et c'est fini. Un viseur doit
 * atterrir dans `UserSights/<identifiant de véhicule>/*.blk`, et les archives
 * publiées n'ont aucune convention commune. Sur onze archives inspectées :
 *
 *   userSights/all_tanks/*.blk        marqueur présent, casse variable
 *   NomDuPack/germ_.../*.blk          dossier racine puis véhicules
 *   ussr_zsu_57_2/*.blk               véhicules directement à la racine
 *   Prinz_Eugen.blk                   un réticule seul, sans dossier
 *
 * Le repère fiable n'est pas le nom du dossier racine, c'est le nom des
 * dossiers de véhicules : ils reprennent les identifiants de la taxonomie de
 * Live, que l'application embarque déjà. Vérifié sur une installation réelle,
 * 497 dossiers sur 498 correspondent, le seul intrus étant `all_tanks`.
 *
 * Ce module est pur : il reçoit une liste de noms d'entrées et rend un plan.
 * Il se teste sans réseau ni système de fichiers.
 */

/** Dossier du jeu qui s'applique à tous les véhicules d'un coup. */
const WILDCARD = "all_tanks";

export interface SightPlan {
  /** Préfixe à retirer de chaque entrée avant extraction. "" = rien à retirer. */
  strip: string;
  /** Dossiers de véhicules trouvés, relatifs après retrait du préfixe. */
  vehicles: string[];
  /** Comment la structure a été reconnue, pour le diagnostic. */
  via: "marker" | "vehicles" | "single-vehicle";
  /** Seuls les fichiers de la racine sont posés ; le reste est laissé de côté. */
  rootOnly?: boolean;
}

const dirname = (p: string) => {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
};

/**
 * Cherche un dossier `UserSights` dans l'archive, quelle que soit sa casse.
 * Quand il existe, il désigne sans ambiguïté ce qu'il faut extraire.
 */
function findMarker(entries: string[]): string | null {
  for (const e of entries) {
    const m = e.match(/(^|.*\/)(usersights)\//i);
    if (m) return m[1] + m[2];
  }
  return null;
}

/**
 * Construit le plan d'extraction, ou `null` si l'archive n'a pas de structure
 * exploitable. Refuser vaut mieux que deviner : un viseur posé dans le mauvais
 * dossier ne s'affiche pas en jeu, et le joueur n'a aucun moyen de comprendre
 * pourquoi.
 *
 * @param entries   noms d'entrées du zip, séparateur `/`
 * @param knownIds  identifiants de véhicules de la taxonomie, en minuscules
 */
export function planSightLayout(entries: string[], knownIds: Set<string>): SightPlan | null {
  const files = entries.filter((e) => !e.endsWith("/"));
  if (files.length === 0) return null;

  const isVehicle = (name: string) =>
    name.toLowerCase() === WILDCARD || knownIds.has(name.toLowerCase());

  // 1. Marqueur explicite : son contenu est exactement ce qu'on veut poser.
  const marker = findMarker(entries);
  if (marker) {
    const strip = marker + "/";
    const inside = files.filter((f) => f.toLowerCase().startsWith(strip.toLowerCase()));
    const vehicles = [
      ...new Set(inside.map((f) => f.slice(strip.length).split("/")[0]).filter(Boolean)),
    ];
    if (vehicles.length > 0) return { strip, vehicles, via: "marker" };
  }

  // Les .blk sont ce qui compte : un readme ou un aperçu jpg posé ailleurs ne
  // doit pas fausser la lecture de la structure.
  const blk = files.filter((f) => f.toLowerCase().endsWith(".blk"));
  if (blk.length === 0) return null;

  // 2. On repère les dossiers de véhicules et on remonte à leur parent commun.
  const parents = new Map<string, Set<string>>();
  for (const f of blk) {
    const dir = dirname(f);
    if (!dir) continue;
    const segments = dir.split("/");
    const leaf = segments[segments.length - 1];
    if (!isVehicle(leaf)) continue;
    const parent = segments.slice(0, -1).join("/");
    const set = parents.get(parent) ?? new Set<string>();
    set.add(leaf);
    parents.set(parent, set);
  }

  if (parents.size > 0) {
    // Le parent qui regroupe le plus de véhicules : une archive peut porter un
    // dossier d'exemples à côté, il ne doit pas l'emporter.
    const [best, vehicles] = [...parents.entries()].sort((a, b) => b[1].size - a[1].size)[0];
    return {
      strip: best ? best + "/" : "",
      vehicles: [...vehicles].sort(),
      via: "vehicles",
    };
  }

  // 3. Aucun dossier de véhicule, mais des .blk à la racine. Ces packs ne
  //    contiennent qu'un réticule destiné à `all_tanks`, parfois accompagné de
  //    variantes rangées dans des sous-dossiers libres ("Default Illumination
  //    Variant/…"). On pose ce qui est à la racine, c'est-à-dire le choix par
  //    défaut de l'auteur, et on laisse les variantes : le jeu ne lit pas ces
  //    sous-dossiers, les copier n'apporterait rien.
  const rootBlk = blk.filter((f) => !f.includes("/"));
  if (rootBlk.length > 0) {
    const rootOnly = rootBlk.length !== blk.length;
    return { strip: "", vehicles: [WILDCARD], via: "single-vehicle", rootOnly };
  }

  return null;
}
