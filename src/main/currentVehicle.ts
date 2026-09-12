/**
 * Le véhicule que le joueur a sous les yeux, lu dans le fichier de profil.
 *
 * `Saves/<uid>/production/global.blk` porte un bloc `selectedAir` — le nom date
 * de l'époque où le jeu n'avait que des avions, il couvre aujourd'hui tous les
 * types :
 *
 *     selectedAir{
 *       current_model:t="ussr_t_44_100"
 *       france:t="fr_amx_30_1972"
 *       germany:t="germ_leopard_I"
 *       ussr:t="ussr_su_100p"
 *     }
 *
 * `current_model` est le véhicule sélectionné, les autres clés retiennent le
 * dernier choix par nation.
 *
 * Vérifié en conditions réelles : le jeu réécrit le fichier AU MOMENT du
 * changement de véhicule, pas à la fermeture. Deux bascules observées, dont un
 * changement de nation. La détection est donc vivante, pas différée.
 *
 * Ces identifiants sont ceux de la taxonomie de Live — `ussr_t_44_100` y
 * désigne « T-44-100 » — donc le filtre véhicule de l'application les accepte
 * tels quels, sans table de correspondance.
 *
 * On LIT, rien d'autre. Aucun contact avec le processus du jeu : c'est la même
 * nature d'opération que la lecture de `config.blk`.
 */

import { promises as fs, watchFile, unwatchFile } from "fs";
import path from "path";
import { resolveProfileDir } from "./wtProfile.js";

export interface VehicleSelection {
  /** Véhicule sélectionné, identifiant de la taxonomie. */
  current: string | null;
  /** Dernier véhicule retenu par nation : `germany` → `germ_leopard_I`. */
  byNation: Record<string, string>;
}

const VIDE: VehicleSelection = { current: null, byNation: {} };

/**
 * Extrait le bloc `selectedAir`. Les accolades se comptent plutôt que de se
 * chercher au motif : le fichier fait 280 Ko et d'autres blocs s'y imbriquent.
 */
function selectedAirBlock(text: string): string | null {
  const head = /(^|\r?\n)[ \t]*selectedAir[ \t]*\{/.exec(text);
  if (!head) return null;
  const open = head.index + head[0].length - 1;

  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open + 1, i);
  }
  return null; // accolade jamais refermée : fichier tronqué en cours d'écriture
}

/** Pur : du texte de `global.blk` entre, une sélection sort. */
export function parseSelection(text: string): VehicleSelection {
  const inner = selectedAirBlock(text);
  if (!inner) return VIDE;

  const byNation: Record<string, string> = {};
  let current: string | null = null;

  for (const m of inner.matchAll(/^[ \t]*([a-z_][\w]*)[ \t]*:[ \t]*t[ \t]*=[ \t]*"([^"]*)"/gim)) {
    const [, cle, valeur] = m;
    if (!valeur) continue;
    if (cle === "current_model") current = valeur;
    else byNation[cle.toLowerCase()] = valeur;
  }
  return { current, byNation };
}

/** Chemin du fichier de profil, ou null si le jeu n'a jamais tourné ici. */
export async function globalBlkPath(): Promise<string | null> {
  const dir = await resolveProfileDir();
  return dir ? path.join(dir, "global.blk") : null;
}

/**
 * Lit la sélection courante. Rend une sélection vide plutôt que d'échouer :
 * ne pas savoir quel véhicule est choisi n'est pas une erreur, c'est
 * simplement l'état d'un joueur qui n'a pas lancé le jeu.
 */
export async function readSelection(): Promise<VehicleSelection> {
  const file = await globalBlkPath();
  if (!file) return VIDE;
  try {
    return parseSelection(await fs.readFile(file, "utf8"));
  } catch {
    return VIDE;
  }
}

/**
 * Prévient à chaque changement de véhicule, et rend de quoi arrêter d'écouter.
 *
 * `watchFile` interroge la date du fichier plutôt que de s'abonner au système :
 * c'est moins élégant mais ça marche sur un fichier réécrit en entier par un
 * autre processus, là où `fs.watch` rate des événements ou tient un handle.
 *
 * Le rappel ne part que si le véhicule a VRAIMENT changé : le jeu réécrit
 * `global.blk` pour des dizaines de raisons, et réveiller l'interface à chaque
 * fois lui ferait relancer des recherches pour rien.
 */
export function watchSelection(
  onChange: (s: VehicleSelection) => void,
  intervalMs = 1000
): () => void {
  let stopped = false;
  let dernier: string | null = null;
  let file: string | null = null;

  const relire = async () => {
    const s = await readSelection();
    if (stopped || s.current === dernier) return;
    dernier = s.current;
    onChange(s);
  };

  void (async () => {
    file = await globalBlkPath();
    if (!file || stopped) return;
    dernier = (await readSelection()).current;
    if (stopped) return;
    watchFile(file, { interval: intervalMs }, () => void relire());
  })();

  return () => {
    stopped = true;
    if (file) unwatchFile(file);
  };
}
