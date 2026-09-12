/**
 * Le véhicule que le joueur a sous les yeux.
 *
 * DEUX SOURCES, et l'ordre compte.
 *
 * 1. Le serveur HTTP que le jeu ouvre sur `127.0.0.1:8111`, fourni par Gaijin
 *    pour les outils tiers. `/indicators` rend `{"valid":true,"type":"su-9"}`,
 *    et il suit à l'instant près. Vérifié dans le panneau lui-même, jeu
 *    lancé : Su-9, puis Yak-15 deux secondes plus tard, puis MiG-9 — la
 *    latence tient dans le cycle d'interrogation.
 *
 * 2. `Saves/<uid>/production/global.blk`, bloc `selectedAir`. C'était la
 *    première source, et elle s'est révélée mauvaise : sur la même session de
 *    huit minutes elle n'a PAS bougé une seule fois. Le jeu ne l'écrit
 *    qu'épisodiquement, d'où le retard d'une trentaine de secondes signalé.
 *    Elle reste utile quand le jeu ne tourne pas : elle garde le dernier
 *    véhicule de la session précédente.
 *
 * Les identifiants des deux sources sont ceux de la taxonomie de Live —
 * `su-9`, `yak-15`, `mig-9_ussr` y figurent tous — donc le filtre véhicule de
 * l'application les accepte sans table de correspondance.
 *
 * On LIT, rien d'autre : une requête GET sur la boucle locale et un fichier
 * sous Documents. Aucun contact avec le processus du jeu.
 */

import { promises as fs } from "fs";
import path from "path";
import { endpoints } from "./wtLive.js";
import { resolveProfileDir } from "./wtProfile.js";

export interface VehicleSelection {
  /** Véhicule sélectionné, identifiant de la taxonomie. */
  current: string | null;
  /** Dernier véhicule retenu par nation : `germany` → `germ_leopard_I`. */
  byNation: Record<string, string>;
}

const VIDE: VehicleSelection = { current: null, byNation: {} };

// ------------------------- Source 1 : le serveur du jeu ------------------------- //

/**
 * Le serveur préfixe certains types par une famille de modèles.
 *
 * Relevé sur le jeu : un char rend `tankModels/ussr_t_44_100`, un avion rend
 * `su-9` tout court. Le filtre véhicule attend la forme nue — passer le
 * chemin complet ne remontait aucun camouflage, en silence.
 *
 * On garde le dernier segment plutôt que d'énumérer les préfixes : ça couvre
 * d'avance les familles qu'on n'a pas encore vues, navires compris.
 */
function normaliseType(type: string): string {
  return type.slice(type.lastIndexOf("/") + 1);
}

/**
 * Véhicule courant selon le jeu lui-même, ou `null` s'il ne répond pas.
 *
 * Le délai est court volontairement : cette lecture se répète, et un jeu qui
 * ne tourne pas doit se constater tout de suite plutôt que faire attendre.
 */
export async function readFromGame(): Promise<string | null> {
  try {
    const res = await fetch(`${endpoints().gameApi}/indicators`, {
      signal: AbortSignal.timeout(700),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { valid?: boolean; type?: unknown };
    // `valid: false` arrive entre deux écrans : le jeu tourne mais n'est dans
    // aucun véhicule. Ce n'est pas une panne, c'est « rien à dire ».
    if (!data.valid || typeof data.type !== "string" || !data.type) return null;
    return normaliseType(data.type);
  } catch {
    // Jeu fermé, serveur pas encore levé, ou transition d'écran.
    return null;
  }
}

// ------------------------- Source 2 : le fichier de profil ------------------------- //

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
 * Lit le profil. Rend une sélection vide plutôt que d'échouer : ne pas savoir
 * quel véhicule est choisi n'est pas une erreur, c'est l'état d'un joueur qui
 * n'a pas encore lancé le jeu.
 */
export async function readFromProfile(): Promise<VehicleSelection> {
  const file = await globalBlkPath();
  if (!file) return VIDE;
  try {
    return parseSelection(await fs.readFile(file, "utf8"));
  } catch {
    return VIDE;
  }
}

// ------------------------- Les deux ensemble ------------------------- //

/**
 * Le véhicule courant, serveur du jeu d'abord, profil en repli.
 *
 * Les entrées par nation ne viennent que du profil : le serveur ne les connaît
 * pas, et elles bougent assez peu pour qu'une lecture épisodique suffise.
 */
export async function readSelection(): Promise<VehicleSelection> {
  const [vivant, profil] = await Promise.all([readFromGame(), readFromProfile()]);
  return { current: vivant ?? profil.current, byNation: profil.byNation };
}

/**
 * Le serveur disparaît une à trois secondes à chaque changement d'écran.
 * Retomber aussitôt sur le profil ferait osciller l'affichage entre le vrai
 * véhicule et celui, périmé, du fichier. On garde donc la dernière réponse
 * vivante pendant ce délai avant de céder la main.
 */
const GRACE_MS = 6000;

/**
 * Prévient à chaque changement de véhicule, et rend de quoi arrêter d'écouter.
 *
 * Une seule boucle interroge le serveur ; le profil n'est relu que lorsque le
 * serveur reste muet au-delà du délai de grâce, ou pour les entrées par nation.
 * Le rappel ne part que si le véhicule a VRAIMENT changé.
 */
export function watchSelection(
  onChange: (s: VehicleSelection) => void,
  intervalMs = 1000
): () => void {
  let stopped = false;
  let dernier: string | null = null;
  let nations: Record<string, string> = {};
  let vuVivantA = 0;

  const tour = async () => {
    if (stopped) return;

    const vivant = await readFromGame();
    if (stopped) return;

    let courant: string | null;
    if (vivant) {
      vuVivantA = Date.now();
      courant = vivant;
    } else if (Date.now() - vuVivantA < GRACE_MS) {
      // Trou de transition : on garde ce qu'on affichait.
      return;
    } else {
      const profil = await readFromProfile();
      if (stopped) return;
      courant = profil.current;
      nations = profil.byNation;
    }

    if (courant === dernier) return;
    dernier = courant;
    // Les nations manquent tant qu'on n'a lu que le serveur : une lecture du
    // profil au moment du changement suffit, elle coûte une milliseconde.
    if (Object.keys(nations).length === 0) nations = (await readFromProfile()).byNation;
    if (stopped) return;
    onChange({ current: courant, byNation: nations });
  };

  const timer = setInterval(() => void tour(), intervalMs);
  void tour();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
