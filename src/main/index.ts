/**
 * Point d'entrée du main process : fenêtre, handlers IPC, config.
 *
 * Tout ce qui est sensible vit ici. Le renderer ne voit que les canaux exposés
 * par le preload — jamais fs, jamais le réseau Live.
 */

import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  session,
  shell,
  Tray,
} from "electron";
import path from "path";
import { fileURLToPath } from "url";
import filtersFallback from "./filters.fallback.json" with { type: "json" };
import { ERR, fail } from "../shared/errors.js";
import { parseDeepLink, setSiteHosts, SCHEME, type DeepLink } from "../shared/deepLink.js";
import { DEFAULT_ENDPOINTS, type Endpoints } from "../shared/endpoints.js";
import { isPortable, resolveEndpoints, startUpdater } from "./updater.js";
import { defaultSelection, planSoundLayout } from "./soundLayout.js";
import { readSelection, watchSelection } from "./currentVehicle.js";
import {
  asIndex,
  asGroups,
  asRecordRef,
  asSearchParams,
  asSkin,
  asAuthorRef,
  asString,
  asUserPage,
} from "../shared/validate.js";
import {
  createConfigStore,
  DEFAULT_OVERLAY_SHORTCUT,
  detectGameDir,
  validateGameDir,
  type WtConfigFile,
} from "./config.js";
import {
  fetchFilters,
  fetchPage,
  fetchPost,
  fetchUserPage,
  fetchVehicleFont,
  fingerprint,
  readStockBanks,
  readZipIndex,
  setEndpoints,
  setLibraryDir,
  setVehicleIds,
  getInstaller,
  listForeign,
  listForeignBanks,
  listSoundSlots,
  reassignClaims,
  setSoundSlot,
  type ContentType,
  type InstalledRecord,
  type InstallProgress,
  type SearchParams,
  type Skin,
  type SortKey,
} from "./wtLive.js";

/**
 * Laisse passer au plus un appel toutes les 80 ms, en gardant toujours le
 * dernier : sinon un zip de 90 Mo inonde l'IPC de centaines de messages que
 * l'écran ne peut pas afficher de toute façon.
 */
function throttle(fn: (p: InstallProgress) => void, ms = 80) {
  let last = 0;
  let pending: ReturnType<typeof setTimeout> | null = null;
  return (p: InstallProgress) => {
    const now = Date.now();
    if (pending) clearTimeout(pending);
    if (now - last >= ms) {
      last = now;
      fn(p);
    } else {
      // Le dernier tick doit arriver, sinon la barre resterait à 97 %.
      pending = setTimeout(() => {
        last = Date.now();
        fn(p);
      }, ms - (now - last));
    }
  };
}

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Lien reçu avant que la fenêtre ne soit prête. Le renderer le réclamera au
 * montage : sans cette file, un lien qui démarre l'application se perdrait
 * pendant le temps de chargement.
 */
let pendingLink: DeepLink | null = null;
let endpoints: Endpoints = DEFAULT_ENDPOINTS;

/** Extrait un lien des arguments de lancement (Windows et Linux). */
function linkFromArgv(argv: string[]): DeepLink | null {
  for (const arg of argv) {
    const parsed = parseDeepLink(arg);
    if (parsed) return parsed;
  }
  return null;
}

/*
 * Un site web peut déclencher `wtcm://` en rafale : chaque lien remet la
 * fenêtre au premier plan et lance une requête. Le verrou d'instance unique
 * évite la multiplication de processus, pas le harcèlement.
 */
let lastLink = 0;

function deliverLink(link: DeepLink | null) {
  if (!link) return;
  const now = Date.now();
  if (now - lastLink < 1000) return;
  lastLink = now;
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send("app:deepLink", link);
    if (win.isMinimized()) win.restore();
    win.focus();
  } else {
    pendingLink = link;
  }
}

let store: ReturnType<typeof createConfigStore>;
let win: BrowserWindow | null = null;
let overlay: BrowserWindow | null = null;
let tray: Tray | null = null;

/**
 * Vrai à partir du moment où l'utilisateur demande vraiment à quitter.
 *
 * Fermer la fenêtre principale la range dans la zone de notification au lieu
 * de terminer l'application : le panneau reste atteignable au raccourci
 * pendant qu'on joue, ce qui est tout son intérêt. Sans ce drapeau, « Quitter »
 * ne ferait que masquer la fenêtre et l'application deviendrait impossible à
 * arrêter autrement qu'au gestionnaire de tâches.
 */
let quitting = false;

/**
 * (Ré)enregistre le raccourci du panneau.
 *
 * Rend faux quand la combinaison est refusée — déjà prise par une autre
 * application, ou invalide. Ce n'est pas une panne : le panneau reste
 * atteignable depuis la barre latérale, et l'interface le dit.
 */
function applyShortcut(combo: string): boolean {
  globalShortcut.unregisterAll();
  if (!combo) return true;
  try {
    return globalShortcut.register(combo, () => void toggleOverlay()) && globalShortcut.isRegistered(combo);
  } catch {
    return false;
  }
}

/**
 * Panneau flottant : une fenêtre de plus, rien d'autre.
 *
 * Aucun contact avec le processus du jeu — ni injection, ni hook, ni lecture
 * mémoire. BattlEye sanctionne ces trois gestes ; poser une fenêtre au-dessus
 * n'en est aucun. La contrepartie est connue : le plein écran exclusif reprend
 * la surface et masque le panneau. Seul le plein écran fenêtré convient.
 */
function createOverlay() {
  if (overlay && !overlay.isDestroyed()) return overlay;

  overlay = new BrowserWindow({
    width: 440,
    height: 720,
    show: false,
    frame: false,
    resizable: true,
    skipTaskbar: true,
    backgroundColor: "#00000000",
    transparent: true,
    webPreferences: {
      preload: path.join(dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Electron ralentit les minuteurs d'une fenêtre cachée ou masquée. Le
      // panneau passe l'essentiel de son temps caché : sans ceci, il rendait
      // le changement de véhicule avec plusieurs secondes de retard.
      backgroundThrottling: false,
    },
  });

  // "screen-saver" est le seul niveau qui passe au-dessus d'un jeu en plein
  // écran fenêtré sous Windows ; "floating" reste sous lui.
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  overlay.webContents.on("will-navigate", (e) => e.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    overlay.loadURL(`${process.env.ELECTRON_RENDERER_URL}#overlay`);
  } else {
    overlay.loadFile(path.join(dirname, "../renderer/index.html"), { hash: "overlay" });
  }

  overlay.on("closed", () => {
    overlay = null;
  });
  return overlay;
}

/**
 * Icône de la zone de notification.
 *
 * C'est le seul moyen de revenir quand la fenêtre principale est rangée, et
 * le seul endroit où « Quitter » termine réellement l'application. Une
 * application qui se cache sans laisser de porte de sortie visible se fait
 * tuer au gestionnaire de tâches, ce qui laisserait le raccourci global
 * enregistré derrière elle.
 */
interface TrayLabels {
  open: string;
  panel: string;
  quit: string;
}

/**
 * Les libellés viennent du renderer : les traductions vivent là-bas, et le
 * main n'a pas de raison d'en tenir une seconde copie. Le menu se reconstruit
 * quand l'utilisateur change de langue.
 */
function setupTray(labels: TrayLabels) {
  if (!tray) {
    // `build/` fait partie des fichiers embarqués : le chemin vaut depuis les
    // sources comme depuis l'archive de l'application installée.
    tray = new Tray(path.join(dirname, "../../build/icon-32.png"));
    tray.setToolTip(app.getName());
    // Double-clic : le geste que tout le monde essaie en premier.
    tray.on("double-click", () => showMain());
  }
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: labels.open, click: () => showMain() },
      { label: labels.panel, click: () => void toggleOverlay() },
      { type: "separator" },
      {
        label: labels.quit,
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ])
  );
}

function showMain() {
  if (!win || win.isDestroyed()) {
    createWindow();
    return;
  }
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

async function toggleOverlay() {
  const w = createOverlay();
  if (w.isVisible()) {
    w.hide();
    return;
  }

  /*
   * Lecture AVANT l'affichage, pas après.
   *
   * Le guetteur suffit tant que le panneau est ouvert, mais à l'instant où on
   * appuie sur le raccourci c'est le véhicule courant qu'on veut, pas celui
   * d'il y a un instant. Ouvrir sur le mauvais puis se corriger sous les yeux
   * de l'utilisateur est pire que d'attendre : la lecture de `global.blk` a
   * été mesurée à 1,3 ms en médiane sur un profil de 276 Ko, personne ne la
   * verra passer.
   */
  const selection = await readSelection();
  if (!w.isDestroyed() && !w.webContents.isDestroyed()) {
    w.webContents.send("vehicle:changed", selection);
  }
  if (w.isDestroyed()) return;
  w.show();
  w.focus();
}

// ------------------------- Fenêtre ------------------------- //

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 940,
    minHeight: 600,
    show: false,
    backgroundColor: "#0f1119",
    autoHideMenuBar: true,
    // En développement l'icône vient d'ici ; au packaging c'est electron-builder
    // qui prend build/icon.ico.
    icon: path.join(dirname, "../../build/icon.png"),
    webPreferences: {
      preload: path.join(dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.once("ready-to-show", () => win?.show());

  // Le jeu réécrit son profil au moment où le joueur change de véhicule : on
  // pousse le changement plutôt que de faire interroger le renderer.
  const stopWatch = watchSelection((selection) => {
    for (const w of [win, overlay]) {
      if (w && !w.isDestroyed() && !w.webContents.isDestroyed()) {
        w.webContents.send("vehicle:changed", selection);
      }
    }
  });
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win?.hide();
  });
  win.on("closed", () => {
    stopWatch();
    win = null;
  });

  // Rien ne s'ouvre tout seul vers l'extérieur. Un lien cliqué dans la page est
  // refusé sans discuter : le seul chemin vers le navigateur système passe par
  // le canal shell:openExternal, que le renderer n'appelle qu'après avoir fait
  // confirmer la destination à l'utilisateur.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(dirname, "../renderer/index.html"));
  }
}

// ------------------------- Cache court des filtres ------------------------- //
// get_head renvoie 500 Ko de HTML pour une taxonomie qui ne bouge jamais dans
// une session. On ne martèle pas l'API pour ça.

const FILTERS_TTL = 10 * 60 * 1000;
const filtersCache = new Map<ContentType, { at: number; value: unknown }>();

/**
 * Taxonomie de secours, figée à la date du build.
 *
 * `get_head` renvoie du HTML dont on extrait un bloc JS au regex : c'est le
 * point le plus fragile de toute l'application, et s'il casse le joueur perd
 * les 3 200 véhicules d'un coup. Un instantané embarqué garde la navigation
 * utilisable — les véhicules ajoutés depuis manqueront, ce qui est infiniment
 * moins grave qu'une liste vide.
 *
 * Il ne sert que pour les camouflages : c'est le seul type livré, et les autres
 * ont leur propre taxonomie.
 */
/**
 * Alimente la reconnaissance des dossiers de véhicules à partir de la
 * taxonomie. L'installeur de viseurs en a besoin pour lire la structure d'une
 * archive : les dossiers y portent les identifiants de Live.
 */
function feedVehicleIds(taxonomy: unknown): void {
  const variants = (taxonomy as { vehicle?: { variants?: Array<{ value?: string }> } })?.vehicle
    ?.variants;
  if (!Array.isArray(variants)) return;
  setVehicleIds(
    variants.map((v) => v.value).filter((v): v is string => typeof v === "string" && v !== "any")
  );
}

async function cachedFilters(content: ContentType): Promise<unknown> {
  const hit = filtersCache.get(content);
  if (hit && Date.now() - hit.at < FILTERS_TTL) return hit.value;
  try {
    const value = await fetchFilters(content);
    filtersCache.set(content, { at: Date.now(), value });
    if (content === "camouflage") feedVehicleIds(value);
    return value;
  } catch {
    // Le repli est une taxonomie de véhicules générique, pas propre aux
    // camouflages : elle sert aussi bien à filtrer les sights. Le réserver au
    // seul type "camouflage" laissait les autres types planter sans filet.
    // On ne le met PAS en cache : le prochain appel retentera Live.
    feedVehicleIds(filtersFallback);
    return filtersFallback;
  }
}

// ------------------------- Handlers IPC ------------------------- //
// Agnostiques du type de contenu : ils délèguent au registre d'installers.
// Ajouter les viseurs plus tard ne touche pas une ligne d'ici.

async function requireGameDir(): Promise<WtConfigFile> {
  const cfg = await store.get();
  if (!cfg.gameDir) fail(ERR.noGameDir);
  return cfg;
}

function registerIpc() {
  ipcMain.handle("config:get", () => store.get());

  // Le renderer construit ses liens depuis le MÊME manifeste : une seule
  // source de vérité pour tout ce qui touche à l'extérieur.
  ipcMain.handle("app:endpoints", () => ({
    pages: endpoints.pages,
    siteHosts: endpoints.siteHosts,
  }));

  // Le renderer réclame le lien de démarrage quand il est prêt à l'afficher.
  ipcMain.handle("app:takeLink", () => {
    const link = pendingLink;
    pendingLink = null;
    return link;
  });

  // Le presse-papiers passe par le main : le renderer n'a pas d'accès direct,
  // et navigator.clipboard n'est pas fiable sur une page chargée en file://.
  let lastCopy = 0;
  ipcMain.handle("app:copy", (_e, text: unknown) => {
    const now = Date.now();
    if (now - lastCopy < 200) fail(ERR.tooFast);
    lastCopy = now;
    clipboard.writeText(asString(text, 2048));
  });

  /**
   * Favoris d'auteurs. Bascule côté main pour que la liste vive dans la config
   * plutôt que dans le stockage du navigateur : elle survit à un vidage de
   * cache et se retrouvera dans une éventuelle sauvegarde.
   */
  ipcMain.handle("config:toggleFavorite", async (_e, raw: unknown) => {
    const author = asAuthorRef(raw);
    const cfg = await store.get();
    const exists = cfg.favorites.some((f) => f.id === author.id);
    // Plafond : sans lui, rien n'empêche de faire enfler config.json une
    // entrée à la fois. Au-delà, on retire la plus ancienne.
    const MAX_FAVORITES = 500;
    const favorites = exists
      ? cfg.favorites.filter((f) => f.id !== author.id)
      : [...cfg.favorites, { ...author, addedAt: Date.now() }]
          .sort((a, b) => b.addedAt - a.addedAt)
          .slice(0, MAX_FAVORITES);
    await store.set({ favorites });
    return favorites;
  });

  ipcMain.handle("config:detect", () => detectGameDir());

  ipcMain.handle("config:validate", (_e, dir: unknown) => validateGameDir(asString(dir, 4096)));

  // Le dialogue natif vit dans le main : le renderer ne choisit jamais un
  // chemin lui-même, il reçoit celui que l'utilisateur a validé.
  // Les libelles viennent du renderer : le main ne connait pas la langue de l'UI.
  ipcMain.handle("config:pick", async (_e, labels?: { title?: string; buttonLabel?: string }) => {
    const res = await dialog.showOpenDialog(win!, {
      title: labels?.title || "War Thunder installation folder",
      properties: ["openDirectory"],
      buttonLabel: labels?.buttonLabel || "Choose",
    });
    if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true };
    return validateGameDir(res.filePaths[0]);
  });

  // On ne persiste que ce qui a été validé : impossible d'enregistrer un
  // gameDir bidon depuis le renderer.
  ipcMain.handle("config:setGameDir", async (_e, dir: string) => {
    const res = await validateGameDir(dir);
    if (!res.ok) return res;
    await store.set({ gameDir: res.gameDir });
    return res;
  });

  ipcMain.handle("content:search", (_e, params: unknown) =>
    fetchPage(asSearchParams(params) as SearchParams)
  );

  ipcMain.handle("filters:get", (_e, content: unknown) =>
    cachedFilters(asString(content, 32) as ContentType)
  );

  ipcMain.handle("content:post", (_e, lang_group: unknown) =>
    fetchPost(asIndex(lang_group, 100_000_000))
  );

  // Telechargee une fois puis mise en cache : jamais embarquee dans le binaire.
  ipcMain.handle("assets:vehicleFont", () =>
    fetchVehicleFont(path.join(app.getPath("userData"), "skyquake.woff2"))
  );

  ipcMain.handle("content:userPage", (_e, p: unknown) =>
    fetchUserPage(asUserPage(p) as { user: number; content: ContentType; sort?: SortKey; page?: number })
  );

  // Seule porte vers le navigateur système. https uniquement : file: ou un
  // schéma exotique passerait des arguments à un programme local.
  /*
   * Le consentement est demandé côté renderer : le main ne peut pas prouver
   * qu'un humain a cliqué. Il peut au moins borner la cadence — un renderer
   * compromis ne pourra pas ouvrir cinquante onglets d'un coup.
   */
  let lastOpen = 0;
  ipcMain.handle("shell:openExternal", async (_e, raw: unknown) => {
    const url = asString(raw, 2048);
    const now = Date.now();
    if (now - lastOpen < 800) fail(ERR.tooFast);
    lastOpen = now;

    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      fail(ERR.badUrl);
    }
    if (parsed.protocol !== "https:") fail(ERR.badScheme, parsed.protocol);
    await shell.openExternal(parsed.toString());
  });

  /*
   * Installations en cours, indexées par l'identifiant du contenu.
   *
   * Le renderer barre déjà un second clic, mais il ne peut pas garantir qu'une
   * installation soit annulable : seul le main tient le signal qui coupe le
   * téléchargement et l'extraction.
   */
  const running = new Map<number, AbortController>();

  ipcMain.handle(
    "content:install",
    async (e, content: unknown, rawSkin: unknown, folderName?: unknown, groups?: unknown) => {
      const cfg = await requireGameDir();
      // Le contenu est reconstruit champ par champ : il finit persisté dans
      // config.json, donc rien d'arbitraire ne doit y entrer.
      const skin = asSkin(rawSkin) as Skin;
      const name = folderName === undefined ? undefined : asString(folderName, 200);
      // Les dossiers retenus finissent dans config.json et servent à rouvrir
      // l'archive plus tard : ils sont bornés comme le reste.
      const chosen = asGroups(groups);

      const abort = new AbortController();
      running.set(skin.id, abort);

      let record;
      try {
        record = await getInstaller(asString(content, 32) as ContentType).install(skin, cfg, {
          folderName: name,
          groups: chosen,
          signal: abort.signal,
          // Le rendu est limité à ~20 messages par seconde : un gros zip génère
          // des centaines de ticks, inutile de tous les faire traverser l'IPC.
          onProgress: throttle((p) => {
            if (!e.sender.isDestroyed()) e.sender.send("install:progress", { id: skin.id, ...p });
          }),
        });
      } finally {
        running.delete(skin.id);
      }

      // Dédoublonnage : réinstaller un skin déjà présent ne crée pas un doublon
      // de suivi qui laisserait un dossier orphelin à la désinstallation.
      const installed = [
        ...cfg.installed.filter(
          (r) => !(r.contentType === record.contentType && r.lang_group === record.lang_group)
        ),
        record,
      ];
      // Ce qui vient d'être posé appartient à ce mod, et plus à celui qu'il a
      // recouvert : sans ça, deux mods revendiqueraient les mêmes fichiers.
      const settled = reassignClaims(
        installed,
        record.lang_group,
        (record.meta?.files as string[] | undefined) ?? []
      );
      await store.set({ installed: settled });
      // La liste ENTIERE, pas le seul enregistrement pose : recouvrir un mod
      // change aussi le sien, et le renderer qui refabriquait la liste depuis
      // sa copie perdait ce changement.
      return settled;
    }
  );

  /**
   * Ce que contient une archive, SANS la télécharger.
   *
   * Certaines archives son proposent plusieurs dossiers qui posent les mêmes
   * banques : il faut en choisir un. La question se pose donc AVANT le
   * téléchargement, pas après dix minutes d'attente. Deux requêtes Range sur
   * l'index du zip suffisent.
   *
   * Rend `null` quand il n'y a rien à demander : archive plate, dossier unique,
   * ou serveur qui ne sait pas servir un fragment. L'installation suit alors
   * son cours normal.
   */
  ipcMain.handle("content:inspect", async (_e, rawSkin: unknown) => {
    const cfg = await requireGameDir();
    const skin = asSkin(rawSkin) as Skin;
    const entries = await readZipIndex(skin.file.link);
    if (!entries) return null;

    // Le catalogue de banques du jeu sert à reconnaître les variantes préfixées
    // (English_aircraft_gui.bank) : sans lui, elles passeraient pour des banques
    // ordinaires et seraient posées sous un nom que le jeu ne lit pas.
    const plan = planSoundLayout(entries, await readStockBanks(cfg));
    if (!plan) return null;
    // Le renderer n'a pas besoin des chemins complets des entrées : il affiche
    // des dossiers, rend une liste de dossiers, et compare les noms de banques
    // posées à celles des mods déjà actifs pour prévenir d'un recouvrement.
    return {
      needsChoice: plan.needsChoice,
      groups: plan.groups.map((g) => ({
        dir: g.dir,
        count: g.files.length,
        files: g.files,
        clashesWith: g.clashesWith,
      })),
      selected: defaultSelection(plan),
    };
  });

  /**
   * Pose ou retire un contenu sans toucher à ce qui a été téléchargé.
   *
   * Le renderer ne désigne QUE quoi activer : on reprend l'enregistrement
   * réellement stocké, jamais celui qu'il transmet. Sans ça, un enregistrement
   * forgé ferait écrire n'importe où.
   */
  ipcMain.handle("content:setActive", async (_e, raw: unknown, active: unknown) => {
    const cfg = await requireGameDir();
    const ref = asRecordRef(raw);
    const owned = cfg.installed.find(
      (r) => r.contentType === ref.contentType && r.lang_group === ref.lang_group
    );
    if (!owned) fail(ERR.notInstalled, String(ref.lang_group));

    const installer = getInstaller(owned.contentType);
    if (!installer.setActive) fail(ERR.noActivation, owned.contentType);

    const next = await installer.setActive(owned, active === true, cfg);
    const merged = cfg.installed.map((r) =>
      r.contentType === next.contentType && r.lang_group === next.lang_group ? next : r
    );
    const settled = reassignClaims(
      merged,
      next.lang_group,
      (next.meta?.files as string[] | undefined) ?? []
    );
    await store.set({ installed: settled });
    return settled;
  });

  /** Coupe une installation en cours. Sans effet si elle est déjà terminée. */
  ipcMain.handle("content:cancelInstall", (_e, id: unknown) => {
    const controller = running.get(asIndex(id, 100_000_000));
    controller?.abort();
    return Boolean(controller);
  });

  /**
   * Le renderer ne désigne QUE quoi désinstaller, jamais quoi supprimer.
   *
   * On ignore le chemin qu'il transmet et on reprend celui de l'enregistrement
   * réellement stocké : sans ça, un record forgé ferait effacer n'importe quel
   * dossier de UserSkins, y compris les template_* livrés par Gaijin et les
   * skins que le joueur a posés à la main. Un contenu inconnu du registre n'est
   * pas à nous, donc on n'y touche pas.
   */
  ipcMain.handle("content:uninstall", async (_e, raw: unknown) => {
    const cfg = await requireGameDir();
    const ref = asRecordRef(raw);
    const owned = cfg.installed.find(
      (r) => r.contentType === ref.contentType && r.lang_group === ref.lang_group
    );
    if (!owned) fail(ERR.notInstalled, String(ref.lang_group));

    await getInstaller(owned.contentType).uninstall(owned, cfg);
    await store.set({
      installed: cfg.installed.filter(
        (r) => !(r.contentType === owned.contentType && r.lang_group === owned.lang_group)
      ),
    });
  });

  /**
   * Rafraîchit les instantanés des contenus installés et signale ceux qui ont
   * été republiés depuis. Séquentiel et espacé : ouvrir l'onglet avec cinquante
   * contenus ne doit pas déclencher cinquante requêtes simultanées contre une
   * API non officielle.
   */
  ipcMain.handle("content:refreshInstalled", async () => {
    const cfg = await requireGameDir();
    const next: InstalledRecord[] = [];

    for (const record of cfg.installed) {
      try {
        // Même liste blanche qu'à l'installation : cet instantané est
        // persisté et relu à chaque démarrage, il ne peut pas venir brut de
        // l'API. Ce chemin-là contournait la validation.
        const fresh = asSkin(await fetchPost(record.lang_group)) as Skin;
        next.push({
          ...record,
          snapshot: fresh,
          refreshedAt: Date.now(),
          // L'empreinte d'origine ne bouge pas : c'est elle qui dit ce qui est
          // réellement posé sur le disque. La comparaison se fait côté UI.
          fingerprint: record.fingerprint ?? (record.snapshot ? fingerprint(record.snapshot) : undefined),
        });
      } catch {
        // Contenu supprimé de Live, ou réseau absent : on garde l'existant.
        next.push(record);
      }
      await new Promise((r) => setTimeout(r, 350));
    }

    await store.set({ installed: next });
    return next;
  });

  ipcMain.handle("content:foreign", async () => listForeign(await requireGameDir()));

  /**
   * Banques posées dans `sound/mod` sans passer par l'application.
   *
   * Le renderer s'en sert pour prévenir d'un recouvrement : sans elles,
   * l'avertissement ne voit que ce que l'application se souvient d'avoir posé,
   * donc rien d'une installation faite à la main.
   */
  ipcMain.handle("content:foreignBanks", async () => listForeignBanks(await requireGameDir()));

  /**
   * Véhicule que le joueur a sélectionné dans le jeu.
   *
   * Lu dans son fichier de profil, jamais dans le processus du jeu. Ne demande
   * pas que le dossier du jeu soit configuré : le profil vit ailleurs, sous
   * Documents, et peut se lire avant même le premier réglage.
   */
  ipcMain.handle("vehicle:current", () => readSelection());

  /** Le panneau se referme lui-même ; la fenêtre reste prête pour la suite. */
  ipcMain.handle("overlay:hide", () => {
    if (overlay && !overlay.isDestroyed()) overlay.hide();
  });

  ipcMain.handle("overlay:toggle", () => toggleOverlay());

  /**
   * Libellés du menu de la zone de notification, envoyés par le renderer au
   * montage et à chaque changement de langue.
   */
  ipcMain.handle("app:trayLabels", (_e, raw: unknown) => {
    const l = (raw ?? {}) as Record<string, unknown>;
    setupTray({
      open: asString(l.open, 80),
      panel: asString(l.panel, 80),
      quit: asString(l.quit, 80),
    });
  });

  /**
   * Change le raccourci du panneau. Rend `false` si le système le refuse,
   * auquel cas on remet celui d'avant plutôt que de laisser l'utilisateur
   * sans raccourci du tout.
   */
  ipcMain.handle("overlay:setShortcut", async (_e, raw: unknown) => {
    const combo = asString(raw, 64).trim();
    const avant = (await store.get()).overlayShortcut || DEFAULT_OVERLAY_SHORTCUT;
    if (!applyShortcut(combo)) {
      applyShortcut(avant);
      return false;
    }
    await store.set({ overlayShortcut: combo });
    return true;
  });

  /**
   * Ouvre une fiche dans la fenêtre principale depuis le panneau.
   *
   * Le panneau fait quatre cents pixels de large : une fiche détaillée n'y
   * tiendrait pas. On réemploie le canal des liens entrants, qui sait déjà
   * ramener la fenêtre au premier plan et y ouvrir un contenu.
   */
  ipcMain.handle("overlay:openInMain", (_e, langGroup: unknown) => {
    const link: DeepLink = {
      kind: "post",
      langGroup: asIndex(langGroup, Number.MAX_SAFE_INTEGER),
    };
    // Pas par `deliverLink` : son limiteur d'une seconde existe contre un site
    // qui déclencherait `wtcm://` en rafale. Ici c'est notre propre panneau, et
    // le limiteur avalait le second clic quand on comparait deux camouflages.
    if (!win || win.isDestroyed()) {
      pendingLink = link;
      showMain();
      return;
    }
    showMain();
    if (!win.webContents.isDestroyed()) win.webContents.send("app:deepLink", link);
  });

  /** Le tableau du mixeur : un emplacement sonore par ligne. */
  ipcMain.handle("content:slots", async () => listSoundSlots(await requireGameDir()));

  /**
   * Donne un emplacement à un mod, ou le rend au son d'origine du jeu.
   *
   * Le renderer ne désigne QUE la place et le mod : les chemins viennent des
   * enregistrements stockés, jamais de ce qu'il transmet.
   */
  ipcMain.handle("content:setSlot", async (_e, slot: unknown, to: unknown) => {
    const cfg = await requireGameDir();
    const installed = await setSoundSlot(
      cfg,
      asString(slot, 260),
      to === null || to === undefined ? null : asIndex(to, Number.MAX_SAFE_INTEGER)
    );
    await store.set({ installed });
    return installed;
  });

  ipcMain.handle("shell:openSkinsFolder", async () => {
    const cfg = await requireGameDir();
    await shell.openPath(path.join(cfg.gameDir, "UserSkins"));
  });
}

// ------------------------- Démarrage ------------------------- //

// CSP posée en en-tête plutôt qu'en <meta> : ça laisse le serveur de dev de
// Vite (HMR, preamble React) fonctionner sans affaiblir la règle en production.
// Le renderer n'a aucune raison de joindre le réseau — seules les vignettes de
// Live sont autorisées, et uniquement en images.
const CSP =
  "default-src 'self'; " +
  "img-src 'self' data: https://cdn-live.warthunder.com https://live.warthunder.com; " +
  "style-src 'self' 'unsafe-inline'; " +
  // La police d'icones arrive du main en data: URL, jamais du reseau du renderer.
  "font-src 'self' data:; " +
  "script-src 'self'; " +
  "connect-src 'self'";

function applyCsp() {
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CSP] } });
  });
}

/**
 * L'application n'a besoin d'aucune permission navigateur : ni caméra, ni
 * micro, ni géolocalisation, ni notifications, ni presse-papiers. On refuse
 * tout par défaut plutôt que de compter sur le fait que rien ne les demande —
 * si une injection atteignait un jour le renderer, ces portes seraient déjà
 * fermées. Appliqué aussi en développement.
 */
function denyAllPermissions() {
  session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
}

/*
 * Instance unique.
 *
 * Sans ce verrou, ouvrir un lien `wtcm://` lancerait une SECONDE application,
 * qui écrirait dans la même config et se battrait avec la première. Le second
 * lancement transmet son lien à celle qui tourne déjà, puis s'arrête.
 */
const primary = app.requestSingleInstanceLock();

if (!primary) {
  app.quit();
} else {
  app.on("second-instance", (_e, argv) => deliverLink(linkFromArgv(argv)));

  // macOS passe les liens par un événement dédié plutôt que par argv.
  app.on("open-url", (event, url) => {
    event.preventDefault();
    deliverLink(parseDeepLink(url));
  });

  app.whenReady().then(async () => {
    /*
     * Enregistrement du protocole `wtcm://`.
     *
     * On ne peut PAS revendiquer les URL https://live.warthunder.com : sur
     * Windows, seul un navigateur peut le faire. Un protocole maison est la
     * seule façon qu'un lien partagé ouvre directement l'application ; les URL
     * Live, elles, se collent dans le champ de recherche.
     *
     * En développement, l'exécutable est electron.exe : il faut lui passer le
     * chemin du projet, sinon le lien relancerait Electron sans application.
     */
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient(SCHEME, process.execPath, [path.resolve(process.argv[1])]);
      }
    } else if (!isPortable()) {
      // Pas en portable : le binaire vit dans un dossier de travail qui change,
      // enregistrer ce chemin laisserait une association morte dans le registre
      // dès la fin de la session.
      app.setAsDefaultProtocolClient(SCHEME);
    }

    pendingLink = linkFromArgv(process.argv);

    denyAllPermissions();
    if (!process.env.ELECTRON_RENDERER_URL) applyCsp();

    const userData = app.getPath("userData");
    // Avant toute requête : le manifeste décide de tout ce qui sort. Ordre de
    // priorité — fichier local, manifeste publié, dernier connu, compilé.
    endpoints = await resolveEndpoints(userData);
    setEndpoints(endpoints);
    setSiteHosts(endpoints.siteHosts);

    store = createConfigStore(path.join(userData, "config.json"));
    // Les archives des mods son restent tant que le mod est installé : c'est ce
    // qui permet de le réactiver sans refaire 850 Mo. Hors du dossier du jeu,
    // qui peut vivre sur un autre disque que la configuration.
    setLibraryDir(path.join(userData, "library"));
    // La liste des véhicules sert à lire la structure des archives de viseurs.
    // On l'amorce depuis le repli embarqué : une installation ne doit pas
    // dépendre du fait que le joueur ait ouvert la barre de filtres.
    feedVehicleIds(filtersFallback);

    registerIpc();
    createWindow();

    applyShortcut((await store.get()).overlayShortcut || DEFAULT_OVERLAY_SHORTCUT);

    // Après la fenêtre : une vérification de mise à jour ne doit pas retarder
    // l'affichage. Elle échoue en silence si le réseau manque.
    startUpdater();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("before-quit", () => {
  quitting = true;
  // Le panneau est une fenêtre cachée, pas fermée : sans ceci elle maintient
  // le processus en vie et `window-all-closed` ne se déclenche jamais.
  overlay?.destroy();
  overlay = null;
  tray?.destroy();
  tray = null;
});

app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
