/**
 * Services partagés par tout le renderer : langue, sortie vers le navigateur
 * avec consentement, et orchestration des installations.
 *
 * L'installation vit ici plutôt que dans chaque vue : la grille, la fiche
 * détail et la page auteur proposent toutes le même bouton, et devaient sinon
 * dupliquer la boîte de renommage, la barre de progression et la gestion
 * d'erreur.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  api,
  formatSize,
  setPages,
  suggestName,
  type ContentType,
  type InstalledRecord,
  type Progress,
  type Skin,
} from "./api";
import { LANGS, LOCALE, loadLang, saveLang, translator, type Key, type Lang, type T } from "./i18n";
import { splitError } from "../../shared/errors";
import { setSiteHosts } from "../../shared/deepLink";
import { useFocusTrap } from "./useFocusTrap";
import { IconClose } from "./icons";

type Toast = { id: number; msg: string; kind: "ok" | "err" };

interface Shell {
  /** Type de contenu affiché. Toutes les vues et l'installation le suivent. */
  content: ContentType;
  setContent: (c: ContentType) => void;
  lang: Lang;
  /** Locale BCP-47 correspondante, pour Intl. */
  locale: string;
  /** Traduit un message d'erreur venu du main (code + detail). */
  tError: (message: string) => string;

  setLang: (l: Lang) => void;
  t: T;
  /** Ouvre un lien hors de l'app, après confirmation explicite. */
  openExternal: (url: string) => void;
  notify: (msg: string, kind?: "ok" | "err") => void;
  /** Copie un texte via le main : le renderer n'a pas d'accès direct. */
  copy: (text: string, confirmation: string) => void;
  toasts: Toast[];

  installed: InstalledRecord[];
  recordFor: (langGroup: number) => InstalledRecord | undefined;
  /** Ouvre la boîte de renommage puis installe. */
  requestInstall: (skin: Skin) => void;
  uninstall: (record: InstalledRecord, label?: string) => Promise<void>;
  busyId: number | null;
  busyGroup: number | null;
  progress: Progress | null;
}

const Ctx = createContext<Shell>(null as unknown as Shell);
export const useShell = () => useContext(Ctx);



export function ShellProvider({
  installed,
  onInstalledChange,
  content,
  onContent,
  children,
}: {
  installed: InstalledRecord[];
  onInstalledChange: (records: InstalledRecord[]) => void;
  content: ContentType;
  onContent: (c: ContentType) => void;
  children: ReactNode;
}) {
  const [lang, setLangState] = useState<Lang>(loadLang);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
  const [pendingSkin, setPendingSkin] = useState<Skin | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Miroir synchrone de busyId : l'état React arrive trop tard pour barrer un
  // second clic dans la même salve d'événements.
  const busyRef = useRef<number | null>(null);
  const [busyGroup, setBusyGroup] = useState<number | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);

  const t = useMemo(() => translator(lang), [lang]);

  // Le main emet des codes stables ("E_DOWNLOAD: 404"), jamais du texte : on
  // traduit le code et on garde le detail brut, qui n'a pas a etre traduit.
  const tError = useCallback(
    (message: string) => {
      const { code, detail } = splitError(String(message ?? ""));
      const known = translator(lang)(code as Key);
      // Une cle inconnue renvoie la cle elle-meme : dans ce cas on montre le
      // message d'origine plutot qu'un code opaque.
      if (known === code) return String(message);
      return detail ? `${known} (${detail})` : known;
    },
    [lang]
  );

  const setLang = useCallback((l: Lang) => {
    saveLang(l);
    setLangState(l);
  }, []);

  const notify = useCallback((msg: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, msg, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), 4500);
  }, []);

  // Un seul abonnement pour toute l'app : le main pousse la progression du
  // téléchargement puis de l'extraction.
  useEffect(() => api.content.onProgress(setProgress), []);

  /*
   * Manifeste des adresses, réclamé au main au démarrage.
   *
   * Le renderer ne fabrique aucune URL de lui-même : gabarits de pages et hôtes
   * reconnus viennent de la même source que les appels sortants. Si le
   * manifeste est remplacé, les liens construits et les liens entrants suivent
   * ensemble — sinon l'un des deux resterait sur l'ancienne adresse.
   */
  useEffect(() => {
    api
      .endpoints()
      .then((e) => {
        setPages(e.pages);
        setSiteHosts(e.siteHosts);
      })
      .catch(() => undefined);
  }, []);

  // Police d'icônes des véhicules : le main la télécharge et la met en cache,
  // on l'injecte en data: URL. Si elle manque, les marqueurs restent affichés
  // en caractères bruts — dégradé, mais lisible.
  useEffect(() => {
    let alive = true;
    api.vehicleFont().then((b64) => {
      if (!alive || !b64 || document.getElementById("skyquake-font")) return;
      const style = document.createElement("style");
      style.id = "skyquake-font";
      style.textContent =
        `@font-face{font-family:'Skyquake';` +
        `src:url(data:font/woff2;base64,${b64}) format('woff2');font-display:swap}`;
      document.head.appendChild(style);
      document.documentElement.classList.add("has-skyquake");
    });
    return () => {
      alive = false;
    };
  }, []);

  // Un même lang_group ne désigne jamais deux contenus, même de types
  // différents : pas besoin de filtrer par type actif pour le retrouver.
  // Nécessaire depuis que l'onglet Installés montre tous les types ensemble —
  // un filtre par `content` y faisait chercher un sight sous le type
  // camouflage actif, donc jamais le trouver.
  const recordFor = useCallback(
    (langGroup: number) => installed.find((r) => r.lang_group === langGroup),
    [installed]
  );

  const doInstall = useCallback(
    async (skin: Skin, folderName: string) => {
      // Une seule à la fois : `busyId` ne retient qu'une valeur, donc une
      // seconde installation lancée pendant la première écrasait le suivi et
      // figeait sa barre de progression alors qu'elle continuait.
      if (busyRef.current !== null) return;
      busyRef.current = skin.id;
      setBusyId(skin.id);
      setProgress(null);
      try {
        const rec = await api.content.install(content, skin, folderName);
        onInstalledChange([...installed.filter((r) => r.lang_group !== rec.lang_group), rec]);
        notify(t("installedToast", { name: rec.name }));
        // Un dossier de véhicule sight est partagé entre paquets : celui-ci
        // vient d'en écraser un autre sur disque, ça se dit.
        const overwrites = rec.meta?.overwrites as string[] | undefined;
        if (overwrites && overwrites.length > 0) {
          notify(t("sightOverwriteToast", { names: overwrites.join(", ") }));
        }
      } catch (e) {
        // Une annulation n'est pas un échec : dire « échec de l'installation »
        // à quelqu'un qui vient de cliquer sur Annuler serait absurde.
        const { code } = splitError(String((e as Error)?.message ?? ""));
        if (code === "E_CANCELED") notify(t("installCanceled"));
        else notify(t("installFailed", { reason: tError((e as Error).message) }), "err");
      } finally {
        busyRef.current = null;
        setBusyId(null);
        setProgress(null);
      }
    },
    [installed, onInstalledChange, notify, t, tError, content]
  );

  const uninstall = useCallback(
    async (record: InstalledRecord, label?: string) => {
      setBusyGroup(record.lang_group);
      try {
        await api.content.uninstall(record);
        onInstalledChange(installed.filter((r) => r.lang_group !== record.lang_group));
        notify(t("uninstalledToast", { name: label ?? record.name }));
      } catch (e) {
        notify(t("uninstallFailed", { reason: tError((e as Error).message) }), "err");
      } finally {
        setBusyGroup(null);
      }
    },
    [installed, onInstalledChange, notify, t, tError]
  );

  const copy = useCallback(
    (text: string, confirmation: string) => {
      api
        .copy(text)
        .then(() => notify(confirmation))
        .catch((e) => notify(tError((e as Error).message), "err"));
    },
    [notify, tError]
  );

  const value: Shell = {
    content,
    setContent: onContent,
    lang,
    copy,
    locale: LOCALE[lang],
    tError,
    setLang,
    t,
    openExternal: setPendingUrl,
    notify,
    toasts,
    installed,
    recordFor,
    requestInstall: (skin: Skin) => busyRef.current === null && setPendingSkin(skin),
    uninstall,
    busyId,
    busyGroup,
    progress,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      {pendingUrl && <ExternalConfirm url={pendingUrl} onClose={() => setPendingUrl(null)} />}
      {pendingSkin && (
        <InstallDialog
          skin={pendingSkin}
          onCancel={() => setPendingSkin(null)}
          onConfirm={(name) => {
            const skin = pendingSkin;
            setPendingSkin(null);
            void doInstall(skin, name);
          }}
        />
      )}
    </Ctx.Provider>
  );
}

// ------------------------- Sélecteur de langue ------------------------- //

export function LanguageSwitch() {
  const { lang, setLang, t } = useShell();
  return (
    <div className="lang-row" role="group" aria-label={t("language")}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          className={l.code === lang ? "lang-btn active" : "lang-btn"}
          onClick={() => setLang(l.code)}
          aria-pressed={l.code === lang}
          title={l.label}
        >
          {l.code.toUpperCase()}
        </button>
      ))}
    </div>
  );
}

/** Lockup de marque : monogramme encadré + sur-titre espacé, comme au canvas. */
export function Brand() {
  const { t } = useShell();
  return (
    <div className="brand">
      <div className="monogram" aria-hidden="true">
        {t("monogram")}
      </div>
      <div className="brand-text">
        <span className="brand-top">{t("brandTop")}</span>
        <span className="brand-bottom">{t("brandBottom")}</span>
      </div>
    </div>
  );
}

// ------------------------- Sortie vers le navigateur ------------------------- //

/**
 * Rien ne part vers l'extérieur sans un oui explicite. L'URL complète est
 * affichée telle quelle : c'est la seule façon pour l'utilisateur de juger de
 * la destination avant de partir.
 */
function ExternalConfirm({ url, onClose }: { url: string; onClose: () => void }) {
  const { t, notify, tError } = useShell();
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal small"
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("externalTitle")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-body">
          <h2>{t("externalTitle")}</h2>
          <p className="muted">{t("externalBody")}</p>
          <p className="external-url">{url}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={onClose}>
              {t("cancel")}
            </button>
            <button
              className="btn primary"
              onClick={() => {
                api.openExternal(url).catch((e) => notify(tError((e as Error).message), "err"));
                onClose();
              }}
            >
              {t("externalOpen")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------- Boîte d'installation ------------------------- //

function InstallDialog({
  skin,
  onCancel,
  onConfirm,
}: {
  skin: Skin;
  onCancel: () => void;
  onConfirm: (name: string) => void;
}) {
  const { t, installed } = useShell();
  const [name, setName] = useState(() => suggestName(skin));
  const inputRef = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);

  useEffect(() => {
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const trimmed = name.trim();
  // Le main réassainit de toute façon ; ici on prévient juste avant de cliquer.
  const invalid = !trimmed || /[<>:"|?*\\/]/.test(trimmed);
  const taken = installed.some(
    (r) => r.name.toLowerCase() === trimmed.toLowerCase() && r.lang_group !== skin.lang_group
  );

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div
        className="modal small"
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("installTitle")}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-body">
          <h2>{t("installNamed", { name: suggestName(skin) })}</h2>
          <label className="field-label" htmlFor="install-name">
            {t("installNameLabel")}
          </label>
          <input
            id="install-name"
            ref={inputRef}
            className="input"
            value={name}
            autoFocus
            spellCheck={false}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !invalid) onConfirm(trimmed);
            }}
          />
          <p className="hint">{t("installNameHelp")}</p>
          {invalid && <p className="error">{t("installNameInvalid")}</p>}
          {!invalid && taken && <p className="warn">{t("installNameTaken")}</p>}

          <div className="modal-actions">
            <button className="btn ghost" onClick={onCancel}>
              {t("cancel")}
            </button>
            <button className="btn primary" disabled={invalid} onClick={() => onConfirm(trimmed)}>
              {t("confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ------------------------- Bouton install / désinstall ------------------------- //

function pct(p: Progress): number {
  if (!p.total) return 0;
  const ratio = p.loaded / p.total;
  // Le téléchargement occupe les 90 premiers pour cent, l'extraction le reste :
  // sur une grosse archive le dézip est bien plus court que le transfert.
  return p.phase === "download" ? ratio * 90 : 90 + ratio * 10;
}

/**
 * Barre de progression. Deux libellés : la phase à gauche, l'avancée chiffrée à
 * droite — en octets pendant le transfert, en pourcentage à l'extraction, où
 * compter des fichiers ne dirait rien à personne.
 */
function Progress({
  live,
  phase,
  onCancel,
}: {
  live: Progress | null;
  phase: string;
  onCancel?: () => void;
}) {
  const { locale, t } = useShell();
  const width = live ? pct(live) : 3;
  const right = live?.total
    ? live.phase === "download"
      ? `${formatSize(live.loaded, locale)} / ${formatSize(live.total, locale)}`
      : `${Math.round(pct(live))} %`
    : "";
  return (
    <div className="progress-wrap full">
      <div className="progress-head">
        <span>{phase}</span>
        <span className="progress-right">
          {right}
          {onCancel && (
            <button className="progress-cancel" onClick={onCancel} title={t("cancelInstall")}>
              <IconClose size={9} />
            </button>
          )}
        </span>
      </div>
      <div className="progress-track">
        <div className="progress-bar" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

/** Bouton partagé par la grille, la fiche et la page auteur. */
export function InstallButton({
  skin,
  block = true,
  withSize = false,
}: {
  skin: Skin;
  block?: boolean;
  /** Affiche le poids dans le libellé — utile là où il y a la place. */
  withSize?: boolean;
}) {
  const { t, locale, recordFor, requestInstall, uninstall, busyId, busyGroup, progress } = useShell();
  const record = recordFor(skin.lang_group);
  const installing = busyId === skin.id;
  const removing = busyGroup === skin.lang_group;
  const cls = block ? " full" : "";

  if (installing) {
    const live = progress?.id === skin.id ? progress : null;
    return (
      <Progress
        live={live}
        phase={live?.phase === "extract" ? t("extracting") : t("downloading")}
        onCancel={() => api.content.cancelInstall(skin.id)}
      />
    );
  }

  if (removing) {
    return (
      <div className={`progress-wrap${cls}`}>
        <div className="progress-head">
          <span>{t("uninstalling")}</span>
        </div>
        {/* Un rm -rf n'a pas d'étapes à compter : barre indéterminée plutôt
            qu'un pourcentage inventé. */}
        <div className="progress-track">
          <div className="progress-bar indeterminate" />
        </div>
      </div>
    );
  }

  return record ? (
    <button className={`btn danger${cls}`} onClick={() => uninstall(record, skin.file.name)}>
      {t("uninstall")}
    </button>
  ) : (
    <button className={`btn primary${cls}`} onClick={() => requestInstall(skin)}>
      {withSize ? t("installWithSize", { size: formatSize(skin.file.size, locale) }) : t("install")}
    </button>
  );
}

/** Lien vers l'extérieur : passe toujours par la confirmation. */
export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  const { openExternal } = useShell();
  return (
    <button className="link" onClick={() => openExternal(href)}>
      {children}
    </button>
  );
}
