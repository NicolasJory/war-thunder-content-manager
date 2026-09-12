/**
 * Preload — la seule passerelle entre le renderer et le main.
 *
 * Chaque méthode délègue à un canal IPC précis. Rien d'autre n'est exposé :
 * pas de fs, pas de require, pas d'ipcRenderer brut (qui laisserait le
 * renderer appeler n'importe quel canal).
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

interface ProgressEvent {
  id: number;
  phase: "download" | "extract";
  loaded: number;
  total: number;
}

const api = {
  config: {
    get: () => ipcRenderer.invoke("config:get"),
    detect: () => ipcRenderer.invoke("config:detect"),
    validate: (dir: string) => ipcRenderer.invoke("config:validate", dir),
    pick: (labels: { title: string; buttonLabel: string }) =>
      ipcRenderer.invoke("config:pick", labels),
    setGameDir: (dir: string) => ipcRenderer.invoke("config:setGameDir", dir),
    toggleFavorite: (author: unknown) => ipcRenderer.invoke("config:toggleFavorite", author),
  },
  content: {
    search: (params: unknown) => ipcRenderer.invoke("content:search", params),
    filters: (content: string) => ipcRenderer.invoke("filters:get", content),
    post: (langGroup: number) => ipcRenderer.invoke("content:post", langGroup),
    userPage: (params: unknown) => ipcRenderer.invoke("content:userPage", params),
    install: (content: string, skin: unknown, folderName?: string, groups?: string[]) =>
      ipcRenderer.invoke("content:install", content, skin, folderName, groups),
    uninstall: (record: unknown) => ipcRenderer.invoke("content:uninstall", record),
    /** Contenu d'une archive lu sans la télécharger. `null` = rien à demander. */
    inspect: (skin: unknown) => ipcRenderer.invoke("content:inspect", skin),
    /** Pose ou retire un mod son sans toucher à son archive conservée. */
    setActive: (record: unknown, active: boolean) =>
      ipcRenderer.invoke("content:setActive", record, active),
    cancelInstall: (id: number) => ipcRenderer.invoke("content:cancelInstall", id),
    refreshInstalled: () => ipcRenderer.invoke("content:refreshInstalled"),
    foreign: () => ipcRenderer.invoke("content:foreign"),
    /** Banques de `sound/mod` que l'application n'a pas posées. */
    foreignBanks: () => ipcRenderer.invoke("content:foreignBanks"),
    /** Emplacements sonores : qui occupe quoi, qui pourrait. */
    slots: () => ipcRenderer.invoke("content:slots"),
    setSlot: (slot: string, to: number | null) => ipcRenderer.invoke("content:setSlot", slot, to),

    // On n'expose pas ipcRenderer : juste un abonnement à CE canal, avec sa
    // fonction de désabonnement. Le renderer ne peut pas écouter autre chose.
    onProgress: (cb: (p: ProgressEvent) => void) => {
      const handler = (_e: IpcRendererEvent, p: ProgressEvent) => cb(p);
      ipcRenderer.on("install:progress", handler);
      return () => ipcRenderer.removeListener("install:progress", handler);
    },
  },
  /** Panneau flottant : se montre au raccourci, se cache lui-même. */
  overlay: {
    hide: () => ipcRenderer.invoke("overlay:hide"),
    toggle: () => ipcRenderer.invoke("overlay:toggle"),
  },
  /** Véhicule sélectionné dans le jeu, lu dans son fichier de profil. */
  currentVehicle: () => ipcRenderer.invoke("vehicle:current"),
  onVehicleChange: (cb: (s: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, s: unknown) => cb(s);
    ipcRenderer.on("vehicle:changed", handler);
    return () => ipcRenderer.removeListener("vehicle:changed", handler);
  },
  vehicleFont: () => ipcRenderer.invoke("assets:vehicleFont"),
  openSkinsFolder: () => ipcRenderer.invoke("shell:openSkinsFolder"),
  // Le renderer ne doit appeler ceci qu'après consentement explicite.
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),
  copy: (text: string) => ipcRenderer.invoke("app:copy", text),
  /** Lien reçu avant que l'interface ne soit prête, réclamé au montage. */
  takeLink: () => ipcRenderer.invoke("app:takeLink"),
  endpoints: () => ipcRenderer.invoke("app:endpoints"),
  onDeepLink: (cb: (link: unknown) => void) => {
    const handler = (_e: IpcRendererEvent, link: unknown) => cb(link);
    ipcRenderer.on("app:deepLink", handler);
    return () => ipcRenderer.removeListener("app:deepLink", handler);
  },
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;
