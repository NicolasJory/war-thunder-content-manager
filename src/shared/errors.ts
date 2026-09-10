/**
 * Codes d'erreur partagés entre le main et le renderer.
 *
 * Le main ne connaît pas la langue de l'interface et ne doit pas la connaître :
 * il émet un code stable, le renderer le traduit. Le détail variable (un statut
 * HTTP, un chemin) suit le code après un `:` et n'est jamais traduit.
 *
 * Ce fichier ne contient que des constantes, aucune dépendance Node : il peut
 * donc être importé des deux côtés sans faire entrer de code du main dans le
 * bundle du renderer.
 */

export const ERR = {
  noGameDir: "E_NO_GAMEDIR",
  api: "E_API",
  filtersBlock: "E_FILTERS_BLOCK",
  download: "E_DOWNLOAD",
  badSource: "E_BAD_SOURCE",
  downloadTooBig: "E_DOWNLOAD_TOO_BIG",
  downloadStalled: "E_DOWNLOAD_STALLED",
  archiveTooBig: "E_ARCHIVE_TOO_BIG",
  emptyArchive: "E_EMPTY_ARCHIVE",
  outsideDest: "E_OUTSIDE_DEST",
  badFolderName: "E_BAD_NAME",
  badUrl: "E_BAD_URL",
  badScheme: "E_BAD_SCHEME",
  unknownContent: "E_UNKNOWN_CONTENT",
  unknownSort: "E_UNKNOWN_SORT",
  noInstaller: "E_NO_INSTALLER",
  badArgs: "E_BAD_ARGS",
  tooFast: "E_TOO_FAST",
  canceled: "E_CANCELED",
  noSightsDir: "E_NO_SIGHTS_DIR",
  unknownLayout: "E_UNKNOWN_LAYOUT",
  notInstalled: "E_NOT_INSTALLED",
  /** Archive son dont plusieurs dossiers posent les mêmes banques, sans choix reçu. */
  needsChoice: "E_NEEDS_CHOICE",
  /** Dossier des archives conservées non initialisé — bug de démarrage. */
  noLibrary: "E_NO_LIBRARY",
  /** config.blk absent : le jeu n'a jamais été lancé sur cette machine. */
  noConfigBlk: "E_NO_CONFIG_BLK",
  /** Type de contenu qui ne distingue pas « téléchargé » de « posé ». */
  noActivation: "E_NO_ACTIVATION",
} as const;

/** Motifs de rejet d'un dossier de jeu, affichés dans l'écran de configuration. */
export const INVALID = {
  empty: "V_EMPTY",
  notFound: "V_NOT_FOUND",
  notADirectory: "V_NOT_DIR",
  noMarkers: "V_NO_MARKERS",
} as const;

export function fail(code: string, detail?: string): never {
  throw new Error(detail ? `${code}: ${detail}` : code);
}

/**
 * Sépare `CODE: détail` pour que le renderer traduise le code seul.
 *
 * Le code n'est pas toujours en tête : Electron enrobe ce qui traverse
 * `invoke` en `Error invoking remote method 'content:install': Error: E_X`.
 * Découper au premier `:` tombait sur celui du canal IPC, et aucune erreur
 * n'était plus traduite. On cherche donc le code lui-même.
 */
export function splitError(message: string): { code: string; detail: string } {
  const found = /\b[EV]_[A-Z0-9_]+/.exec(message);
  if (found) {
    const rest = message.slice(found.index + found[0].length);
    return { code: found[0], detail: rest.startsWith(":") ? rest.slice(1).trim() : "" };
  }
  const i = message.indexOf(":");
  if (i === -1) return { code: message.trim(), detail: "" };
  return { code: message.slice(0, i).trim(), detail: message.slice(i + 1).trim() };
}
