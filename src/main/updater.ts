/**
 * Mise à jour automatique et manifeste distant.
 *
 * Deux mécanismes de réparation, à deux vitesses :
 *
 *  - `electron-updater` récupère une nouvelle version depuis GitHub Releases.
 *    C'est le canal lourd : il faut publier un binaire, l'utilisateur doit
 *    redémarrer. Réservé aux changements de code.
 *
 *  - Le manifeste distant est un simple JSON dans le dépôt. Le jour où Live
 *    déplace un endpoint, éditer ce fichier répare tous les utilisateurs au
 *    lancement suivant, sans release ni réinstallation. C'est le canal léger,
 *    et c'est celui qui compte le plus : l'API n'est pas officielle.
 *
 * Les deux échouent en silence. Une application qui ne peut pas se mettre à
 * jour doit continuer de fonctionner, pas afficher une erreur à chaque
 * démarrage.
 */

import { app } from "electron";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import electronUpdater from "electron-updater";
import { DEFAULT_ENDPOINTS, mergeEndpoints, type Endpoints } from "../shared/endpoints.js";

const { autoUpdater } = electronUpdater;

/**
 * Manifeste publié, servi en brut depuis la branche principale.
 *
 * Volontairement séparé du code : un correctif d'endpoint ne demande alors
 * qu'un commit, pas un cycle de release.
 */
const REMOTE_MANIFEST =
  "https://raw.githubusercontent.com/NicolasJory/war-thunder-content-manager/main/endpoints.json";

const FETCH_TIMEOUT = 8000;

/**
 * Résout le manifeste selon un ordre de priorité assumé :
 *
 *   1. `endpoints.json` local — la main de l'utilisateur passe avant tout, y
 *      compris pour déboguer ou pointer un serveur de test ;
 *   2. le manifeste distant, mis en cache au dernier succès ;
 *   3. les valeurs compilées.
 *
 * Le cache sert quand le réseau manque : sans lui, une coupure ramènerait aux
 * valeurs d'origine, donc potentiellement cassées.
 */
export async function resolveEndpoints(userData: string): Promise<Endpoints> {
  const localFile = path.join(userData, "endpoints.json");
  const cacheFile = path.join(userData, "endpoints.cache.json");

  // 1. Remplacement local : il gagne, on ne va même pas chercher plus loin.
  try {
    const local = JSON.parse(await readFile(localFile, "utf8"));
    return mergeEndpoints(local);
  } catch {
    /* absent : suite */
  }

  // 2. Manifeste distant, avec mise en cache du dernier succès.
  try {
    const res = await fetch(REMOTE_MANIFEST, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT),
      headers: { Accept: "application/json" },
    });
    if (res.ok) {
      const text = await res.text();
      // Trop gros pour un manifeste : on n'écrit pas ça sur le disque.
      if (text.length < 64_000) {
        const merged = mergeEndpoints(JSON.parse(text));
        await mkdir(userData, { recursive: true });
        await writeFile(cacheFile, text, "utf8");
        return merged;
      }
    }
  } catch {
    /* hors ligne, dépôt privé, fichier absent : suite */
  }

  // 3. Dernier manifeste connu, sinon les valeurs compilées.
  try {
    return mergeEndpoints(JSON.parse(await readFile(cacheFile, "utf8")));
  } catch {
    return DEFAULT_ENDPOINTS;
  }
}

/**
 * Le .exe portable se réextrait à chaque lancement dans un dossier de travail.
 * Rien ne persiste à cet emplacement, donc rien n'y serait mis à jour : une
 * vérification ne pourrait qu'échouer. electron-builder signale ce mode par
 * PORTABLE_EXECUTABLE_DIR.
 */
export function isPortable(): boolean {
  return Boolean(process.env.PORTABLE_EXECUTABLE_DIR);
}

/**
 * Vérifie et installe une nouvelle version.
 *
 * Téléchargement automatique, mais installation au prochain arrêt : couper
 * l'application sous les doigts de quelqu'un qui installe un camouflage serait
 * pire que de le faire attendre une session.
 */
export function startUpdater(): void {
  // En développement il n'y a pas d'app-update.yml : inutile d'essayer.
  if (!app.isPackaged || isPortable()) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  // Un échec de mise à jour ne doit jamais remonter à l'utilisateur : il n'y
  // peut rien, et l'application marche très bien sans.
  autoUpdater.on("error", () => undefined);

  autoUpdater.checkForUpdates().catch(() => undefined);
}
