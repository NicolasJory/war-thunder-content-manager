/**
 * Point d'entrée du main process : fenêtre, handlers IPC, config.
 *
 * Tout ce qui est sensible vit ici. Le renderer ne voit que les canaux exposés
 * par le preload — jamais fs, jamais le réseau Live.
 */

import { app, BrowserWindow, clipboard, dialog, ipcMain, session, shell } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import filtersFallback from "./filters.fallback.json" with { type: "json" };
import { ERR, fail } from "../shared/errors.js";
import { parseDeepLink, setSiteHosts, SCHEME, type DeepLink } from "../shared/deepLink.js";
import { DEFAULT_ENDPOINTS, type Endpoints } from "../shared/endpoints.js";
import { isPortable, resolveEndpoints, startUpdater } from "./updater.js";
import {
  asIndex,
  asRecordRef,
  asSearchParams,
  asSkin,
  asAuthorRef,
  asString,
  asUserPage,
} from "../shared/validate.js";
import {
  createConfigStore,
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
  setEndpoints,
  setVehicleIds,
  getInstaller,
  listForeign,
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
  } catch (e) {
    if (content !== "camouflage") throw e;
    // On ne met PAS le repli en cache : le prochain appel retentera Live.
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
    async (e, content: unknown, rawSkin: unknown, folderName?: unknown) => {
      const cfg = await requireGameDir();
      // Le contenu est reconstruit champ par champ : il finit persisté dans
      // config.json, donc rien d'arbitraire ne doit y entrer.
      const skin = asSkin(rawSkin) as Skin;
      const name = folderName === undefined ? undefined : asString(folderName, 200);

      const abort = new AbortController();
      running.set(skin.id, abort);

      let record;
      try {
        record = await getInstaller(asString(content, 32) as ContentType).install(skin, cfg, {
          folderName: name,
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
      await store.set({ installed });
      return record;
    }
  );

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
    // La liste des véhicules sert à lire la structure des archives de viseurs.
    // On l'amorce depuis le repli embarqué : une installation ne doit pas
    // dépendre du fait que le joueur ait ouvert la barre de filtres.
    feedVehicleIds(filtersFallback);

    registerIpc();
    createWindow();

    // Après la fenêtre : une vérification de mise à jour ne doit pas retarder
    // l'affichage. Elle échoue en silence si le réseau manque.
    startUpdater();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
