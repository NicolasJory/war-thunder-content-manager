/**
 * config.ts — persistance de la config + découverte de l'installation du jeu.
 *
 * Volontairement SANS import d'electron : tout est testable en Node nu
 * (test/config.smoke.ts). C'est index.ts qui injecte le chemin du fichier,
 * via app.getPath('userData').
 */

import { execFile } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";
import { INVALID } from "../shared/errors.js";
import type { InstalledRecord } from "./wtLive.js";

const execFileAsync = promisify(execFile);

const WT_STEAM_APPID = "236390";

// Signature Dagor : les .vromfs.bin n'existent que dans une install War Thunder.
// Plus fiable qu'un .exe, et indépendant de la plateforme.
const MARKERS = ["aces.vromfs.bin", "game.vromfs.bin", "gui.vromfs.bin"];

/** Auteur mis en favori. On garde de quoi l'afficher sans requête. */
export interface FavoriteAuthor {
  id: number;
  nickname: string;
  avatar: string;
  addedAt: number;
}

export interface WtConfigFile {
  gameDir: string;
  installed: InstalledRecord[];
  favorites: FavoriteAuthor[];
  /**
   * Raccourci global qui montre le panneau flottant.
   *
   * Réglable parce qu'il est enregistré à l'échelle du système : la
   * combinaison par défaut peut très bien être déjà prise par une autre
   * application, et rien dans le jeu n'en avertirait.
   */
  overlayShortcut: string;
}

/** Alt+X plutôt qu'une touche seule : War Thunder occupe l'essentiel du clavier. */
export const DEFAULT_OVERLAY_SHORTCUT = "Alt+X";

export const EMPTY_CONFIG: WtConfigFile = {
  gameDir: "",
  installed: [],
  favorites: [],
  overlayShortcut: DEFAULT_OVERLAY_SHORTCUT,
};

// ------------------------- Validation d'un dossier ------------------------- //

export interface ValidationResult {
  ok: boolean;
  gameDir?: string; // racine normalisée
  reason?: string; // code de INVALID — traduit par le renderer
  detail?: string; // chemin concerné, jamais traduit
}

/**
 * Accepte la racine du jeu OU le dossier UserSkins (remonte au parent) : les
 * gens pointent spontanément le dossier des skins, autant l'accepter.
 * Le dossier des skins ne peut pas servir de gameDir — les viseurs vivent dans
 * un tout autre arbre, ils partent de la racine.
 */
export async function validateGameDir(dir: string): Promise<ValidationResult> {
  if (!dir?.trim()) return { ok: false, reason: INVALID.empty };

  let root = path.resolve(dir.trim());
  if (path.basename(root).toLowerCase() === "userskins") root = path.dirname(root);

  try {
    const st = await fs.stat(root);
    if (!st.isDirectory()) return { ok: false, reason: INVALID.notADirectory, detail: root };
  } catch {
    return { ok: false, reason: INVALID.notFound, detail: root };
  }

  const entries = await fs.readdir(root);
  const found = MARKERS.some((m) => entries.includes(m)) || entries.some((e) => e.endsWith(".vromfs.bin"));
  if (!found) {
    return { ok: false, reason: INVALID.noMarkers, detail: root };
  }
  return { ok: true, gameDir: root };
}

// ------------------------- Auto-détection Steam ------------------------- //

async function steamRoot(): Promise<string | null> {
  if (process.platform === "win32") {
    try {
      const { stdout } = await execFileAsync("reg", [
        "query",
        "HKCU\\Software\\Valve\\Steam",
        "/v",
        "SteamPath",
      ]);
      const m = stdout.match(/SteamPath\s+REG_SZ\s+(.+)/i);
      if (m) return path.resolve(m[1].trim());
    } catch {
      // Steam absent ou clé illisible : on retombe sur les emplacements par défaut.
    }
  }
  const defaults = [
    "C:\\Program Files (x86)\\Steam",
    "C:\\Program Files\\Steam",
    path.join(process.env.HOME ?? "", ".steam/steam"),
    path.join(process.env.HOME ?? "", "Library/Application Support/Steam"),
  ];
  for (const d of defaults) {
    try {
      await fs.stat(path.join(d, "steamapps"));
      return d;
    } catch {
      /* suivant */
    }
  }
  return null;
}

/**
 * Extrait les bibliothèques Steam de libraryfolders.vdf. On lit au regex plutôt
 * qu'avec un parseur VDF : le fichier a une forme fixe et on ne veut que deux
 * champs. Une dépendance de plus pour ça ne se justifie pas.
 */
export function parseLibraryFolders(vdf: string): Array<{ path: string; apps: string[] }> {
  const out: Array<{ path: string; apps: string[] }> = [];
  const re = /"path"\s+"([^"]+)"[\s\S]*?"apps"\s*\{([\s\S]*?)\}/g;
  for (const m of vdf.matchAll(re)) {
    out.push({
      path: m[1].replace(/\\\\/g, "\\"),
      apps: [...m[2].matchAll(/"(\d+)"\s+"\d+"/g)].map((a) => a[1]),
    });
  }
  return out;
}

/** Renvoie la racine du jeu si on la trouve, sinon null. Best effort : les
 *  installs hors Steam (launcher Gaijin) ne sont pas découvrables, d'où le
 *  bouton Parcourir qui reste toujours disponible dans l'UI. */
export async function detectGameDir(): Promise<string | null> {
  const steam = await steamRoot();
  if (!steam) return null;

  let libs: Array<{ path: string; apps: string[] }> = [];
  try {
    libs = parseLibraryFolders(
      await fs.readFile(path.join(steam, "steamapps", "libraryfolders.vdf"), "utf8")
    );
  } catch {
    libs = [];
  }
  if (!libs.length) libs = [{ path: steam, apps: [] }];

  // La bibliothèque qui déclare l'appid d'abord, puis toutes les autres en repli
  // (le vdf peut être en retard sur la réalité du disque).
  const ordered = [
    ...libs.filter((l) => l.apps.includes(WT_STEAM_APPID)),
    ...libs.filter((l) => !l.apps.includes(WT_STEAM_APPID)),
  ];
  for (const lib of ordered) {
    const candidate = path.join(lib.path, "steamapps", "common", "War Thunder");
    const res = await validateGameDir(candidate);
    if (res.ok) return res.gameDir!;
  }
  return null;
}

// ------------------------- Lecture / écriture ------------------------- //

export interface ConfigStore {
  get(): Promise<WtConfigFile>;
  set(patch: Partial<WtConfigFile>): Promise<WtConfigFile>;
}

export function createConfigStore(filePath: string): ConfigStore {
  let cache: WtConfigFile | null = null;

  async function get(): Promise<WtConfigFile> {
    if (cache) return cache;
    try {
      const parsed = JSON.parse(await fs.readFile(filePath, "utf8"));
      cache = {
        gameDir: typeof parsed.gameDir === "string" ? parsed.gameDir : "",
        installed: Array.isArray(parsed.installed) ? parsed.installed : [],
        favorites: Array.isArray(parsed.favorites) ? parsed.favorites : [],
        // Absent des configurations écrites avant le panneau flottant : on
        // retombe sur la combinaison par défaut plutôt que sur une chaîne
        // vide, qui aurait laissé l'utilisateur sans raccourci du tout.
        overlayShortcut:
          typeof parsed.overlayShortcut === "string"
            ? parsed.overlayShortcut
            : DEFAULT_OVERLAY_SHORTCUT,
      };
    } catch {
      // Absent ou corrompu : on repart d'une config vide plutôt que de planter
      // au démarrage. L'écran de setup reprend la main.
      cache = { ...EMPTY_CONFIG };
    }
    return cache;
  }

  async function set(patch: Partial<WtConfigFile>): Promise<WtConfigFile> {
    const next = { ...(await get()), ...patch };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
    cache = next;
    return next;
  }

  return { get, set };
}
