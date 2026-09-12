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
  coveredBy,
  coversSomething,
  formatSize,
  isActive,
  setPages,
  soundMeta,
  suggestName,
  type ArchiveChoice,
  type Covered,
  type CoverReport,
  type ContentType,
  type InstalledRecord,
  type Progress,
  type Skin,
} from "./api";
import { LANGS, LOCALE, loadLang, saveLang, translator, type Key, type Lang, type T } from "./i18n";
import { splitError } from "../../shared/errors";
import { setSiteHosts } from "../../shared/deepLink";
import { useFocusTrap } from "./useFocusTrap";
import { useBackdrop } from "./useBackdrop";
import { IconClose } from "./icons";

type Toast = { id: number; msg: string; kind: "ok" | "err" };

/**
 * Types que le main sait poser. Il faut le savoir ici parce que le type est lu
 * sur le contenu lui-meme, pas sur l'onglet ouvert : `skin.type` peut valoir
 * `image` ou `video`, qui ne s'installent pas.
 */
const INSTALLABLE = ["camouflage", "sight", "sound"] as const;

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
  /** Banques de `sound/mod` que l'application n'a pas posées. */
  foreignBanks: string[];
  recordFor: (langGroup: number) => InstalledRecord | undefined;
  /** Ouvre la boîte de renommage puis installe. */
  requestInstall: (skin: Skin) => void;
  uninstall: (record: InstalledRecord, label?: string) => Promise<void>;
  /**
   * Pose ou retire un mod son sans toucher a son archive. Seul le son a cet
   * etat intermediaire : un camouflage est installe ou ne l'est pas.
   */
  setActive: (record: InstalledRecord, active: boolean) => Promise<void>;
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
  // Desinstaller un mod son actif efface ses fichiers ET son archive : on le
  // demande avant, ce qui n'a pas lieu d'etre pour un camouflage.
  const [pendingRemove, setPendingRemove] = useState<{
    record: InstalledRecord;
    label?: string;
  } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);
  // Miroir synchrone de busyId : l'état React arrive trop tard pour barrer un
  // second clic dans la même salve d'événements.
  const busyRef = useRef<number | null>(null);
  const [busyGroup, setBusyGroup] = useState<number | null>(null);
  /**
   * Banques de `sound/mod` posées hors de l'application.
   *
   * Relu à chaque changement de la liste installée, donc après chaque pose ou
   * retrait : une banque qu'on vient de poser cesse aussitôt d'être étrangère.
   */
  const [foreignBanks, setForeignBanks] = useState<string[]>([]);
  const [progress, setProgress] = useState<Progress | null>(null);

  const t = useMemo(() => translator(lang), [lang]);

  useEffect(() => {
    let alive = true;
    api.content
      .foreignBanks()
      .then((list) => alive && setForeignBanks(list))
      // Dossier de jeu pas encore configuré, ou disque indisponible :
      // l'avertissement sera moins complet, rien de plus. Ça ne bloque rien.
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [installed]);

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

  /**
   * Le type vient du contenu lui-meme, pas de l'onglet ouvert.
   *
   * L'onglet Installes montre tous les types ensemble : mettre a jour un viseur
   * depuis cet onglet alors que « Camouflages » etait le dernier type visite
   * l'aurait installe comme un camouflage, donc au mauvais endroit.
   */
  const typeOf = useCallback(
    (skin: Skin): ContentType =>
      (INSTALLABLE as readonly string[]).includes(skin.type)
        ? (skin.type as ContentType)
        : content,
    [content]
  );

  const doInstall = useCallback(
    async (skin: Skin, folderName: string, groups?: string[]) => {
      // Une seule à la fois : `busyId` ne retient qu'une valeur, donc une
      // seconde installation lancée pendant la première écrasait le suivi et
      // figeait sa barre de progression alors qu'elle continuait.
      if (busyRef.current !== null) return;
      busyRef.current = skin.id;
      setBusyId(skin.id);
      setProgress(null);
      try {
        // Le main rend la liste entière : poser un mod change aussi ce que
        // revendiquent ceux qu'il recouvre, et refabriquer la liste ici depuis
        // une copie périmée perdait ce changement.
        const next = await api.content.install(typeOf(skin), skin, folderName, groups);
        onInstalledChange(next);
        const rec = next.find((r) => r.lang_group === skin.lang_group);
        if (!rec) return;
        notify(t("installedToast", { name: rec.name }));
        // Un dossier de véhicule sight, une banque son : les deux sont partagés
        // entre paquets, et celui-ci vient d'en écraser un autre sur disque.
        const overwrites = rec.meta?.overwrites as string[] | undefined;
        if (overwrites && overwrites.length > 0) {
          const key = rec.contentType === "sound" ? "soundOverwriteToast" : "sightOverwriteToast";
          notify(t(key, { names: overwrites.join(", ") }));
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
    [installed, onInstalledChange, notify, t, tError, typeOf]
  );

  const doUninstall = useCallback(
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

  /**
   * Desinstaller un mod son actuellement dans le jeu emporte ses banques ET son
   * archive : rien n'est conserve. Ce n'est pas la meme chose que le desactiver,
   * et la difference se joue sur 850 Mo a retelecharger.
   */
  const uninstall = useCallback(
    async (record: InstalledRecord, label?: string) => {
      if (isActive(record)) {
        setPendingRemove({ record, label });
        return;
      }
      await doUninstall(record, label);
    },
    [doUninstall]
  );

  const setActive = useCallback(
    async (record: InstalledRecord, active: boolean) => {
      setBusyGroup(record.lang_group);
      try {
        const list = await api.content.setActive(record, active);
        onInstalledChange(list);
        const next = list.find((r) => r.lang_group === record.lang_group) ?? record;
        notify(t(active ? "activatedToast" : "deactivatedToast", { name: next.name }));
        const overwrites = soundMeta(next)?.overwrites ?? [];
        if (active && overwrites.length > 0) {
          notify(t("soundOverwriteToast", { names: overwrites.join(", ") }));
        }
      } catch (e) {
        notify(t("activateFailed", { reason: tError((e as Error).message) }), "err");
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
    foreignBanks,
    recordFor,
    requestInstall: (skin: Skin) => busyRef.current === null && setPendingSkin(skin),
    uninstall,
    setActive,
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
          onConfirm={(name, groups) => {
            const skin = pendingSkin;
            setPendingSkin(null);
            void doInstall(skin, name, groups);
          }}
        />
      )}
      {pendingRemove && (
        <RemoveActiveConfirm
          record={pendingRemove.record}
          onCancel={() => setPendingRemove(null)}
          onConfirm={() => {
            const { record, label } = pendingRemove;
            setPendingRemove(null);
            void doUninstall(record, label);
          }}
          onDeactivate={() => {
            const { record } = pendingRemove;
            setPendingRemove(null);
            void setActive(record, false);
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
  const backdrop = useBackdrop(onClose);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" {...backdrop}>
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

const lastSegment = (dir: string) => dir.slice(dir.lastIndexOf("/") + 1);
const parentOf = (dir: string) => (dir.includes("/") ? dir.slice(0, dir.lastIndexOf("/")) : "");

function InstallDialog({
  skin,
  onCancel,
  onConfirm,
}: {
  skin: Skin;
  onCancel: () => void;
  onConfirm: (name: string, groups?: string[]) => void;
}) {
  const { t, installed, foreignBanks } = useShell();
  const [name, setName] = useState(() => suggestName(skin));
  const [choice, setChoice] = useState<ArchiveChoice | null>(null);
  // Seul le son a des archives à plusieurs dossiers : inutile de faire deux
  // requêtes Range pour un camouflage qui n'a rien à demander.
  const [probing, setProbing] = useState(skin.type === "sound");
  const [selected, setSelected] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);
  const backdrop = useBackdrop(onCancel);

  useEffect(() => {
    inputRef.current?.select();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  /**
   * L'index du zip se lit en deux requêtes Range, donc AVANT le téléchargement.
   * Poser la question après dix minutes d'attente serait une insulte.
   *
   * Un échec ici n'est pas bloquant : le main refait le même classement une
   * fois l'archive sur le disque, et refuse alors une archive ambiguë.
   */
  useEffect(() => {
    if (skin.type !== "sound") return;
    let alive = true;
    api.content
      .inspect(skin)
      .then((found) => {
        if (!alive) return;
        setChoice(found);
        setSelected(found?.selected ?? []);
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) setProbing(false);
      });
    return () => {
      alive = false;
    };
  }, [skin]);

  /**
   * Cocher un dossier décoche ceux qui posent les mêmes fichiers.
   *
   * C'est ce qui fait qu'une famille d'alternatives se comporte comme des
   * boutons radio et un ensemble additif comme des cases, sans que le code ait
   * à distinguer les deux : la liste des conflits vient du main.
   */
  const toggle = useCallback(
    (dir: string) => {
      setSelected((prev) => {
        if (prev.includes(dir)) return prev.filter((d) => d !== dir);
        const clash = new Set(choice?.groups.find((g) => g.dir === dir)?.clashesWith ?? []);
        return [...prev.filter((d) => !clash.has(d)), dir];
      });
    },
    [choice]
  );

  // Les alternatives d'une même famille partagent un dossier parent : c'est ce
  // qui permet de les présenter ensemble plutôt qu'en liste plate de 22 lignes.
  const families = useMemo(() => {
    const map = new Map<string, ArchiveChoice["groups"]>();
    for (const g of choice?.groups ?? []) {
      const parent = parentOf(g.dir);
      const list = map.get(parent);
      if (list) list.push(g);
      else map.set(parent, [g]);
    }
    return [...map.entries()];
  }, [choice]);

  /**
   * Ce que cette installation recouvrirait chez les mods son déjà en service.
   *
   * Se recalcule à chaque case cochée : décocher le groupe qui pose
   * `masterbank.bank` fait disparaître l'avertissement, ce qui est exactement
   * l'information utile.
   */
  const covered = useMemo(() => {
    const files = (choice?.groups ?? [])
      .filter((g) => selected.includes(g.dir))
      .flatMap((g) => g.files);
    return coveredBy(files, installed, skin.lang_group, foreignBanks);
  }, [choice, selected, installed, foreignBanks, skin.lang_group]);

  const trimmed = name.trim();
  // Le main réassainit de toute façon ; ici on prévient juste avant de cliquer.
  const invalid = !trimmed || /[<>:"|?*\\/]/.test(trimmed);
  const taken = installed.some(
    (r) => r.name.toLowerCase() === trimmed.toLowerCase() && r.lang_group !== skin.lang_group
  );
  // Un seul groupe : rien à choisir, la case unique n'apporterait rien.
  const showChooser = (choice?.groups.length ?? 0) > 1;
  const nothingPicked = showChooser && selected.length === 0;
  const blocked = invalid || probing || nothingPicked;

  const confirm = () => !blocked && onConfirm(trimmed, showChooser ? selected : undefined);

  return (
    <div className="modal-backdrop" {...backdrop}>
      <div
        className={showChooser ? "modal" : "modal small"}
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
              if (e.key === "Enter") confirm();
            }}
          />
          <p className="hint">{t("installNameHelp")}</p>
          {invalid && <p className="error">{t("installNameInvalid")}</p>}
          {!invalid && taken && <p className="warn">{t("installNameTaken")}</p>}

          {probing && (
            <p className="hint">
              <span className="spinner" /> {t("loading")}
            </p>
          )}

          {showChooser && choice && (
            <section className="choose">
              <h3>{t("chooseTitle")}</h3>
              {families.map(([parent, groups]) => {
                const exclusive = groups.some((g) => g.clashesWith.length > 0);
                return (
                  <div key={parent || "(root)"} className="choose-family">
                    {parent && <p className="choose-parent">{lastSegment(parent)}</p>}
                    <p className="hint">
                      {exclusive ? t("chooseExclusiveHelp") : t("chooseAdditiveHelp")}
                    </p>
                    {groups.map((g) => (
                      <label key={g.dir} className="choose-row">
                        <input
                          type="checkbox"
                          checked={selected.includes(g.dir)}
                          onChange={() => toggle(g.dir)}
                        />
                        <span className="choose-name">
                          {lastSegment(g.dir) || t("chooseRootGroup")}
                        </span>
                        <span className="muted">{t("soundBankCount", { n: g.count })}</span>
                      </label>
                    ))}
                  </div>
                );
              })}
              {nothingPicked && <p className="error">{t("chooseNone")}</p>}
            </section>
          )}

          <OverwriteWarning covered={covered} />

          <div className="modal-actions">
            <button className="btn ghost" onClick={onCancel}>
              {t("cancel")}
            </button>
            <button className="btn primary" disabled={blocked} onClick={confirm}>
              {t("confirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Désinstaller un mod son actif emporte ses banques ET son archive.
 *
 * La désactivation existe précisément pour éviter ça, et l'écart entre les deux
 * se compte en centaines de mégaoctets à retélécharger. On propose donc les
 * deux dans la même boîte plutôt que de laisser choisir à l'aveugle.
 */
function RemoveActiveConfirm({
  record,
  onCancel,
  onConfirm,
  onDeactivate,
}: {
  record: InstalledRecord;
  onCancel: () => void;
  onConfirm: () => void;
  onDeactivate: () => void;
}) {
  const { t } = useShell();
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box);
  const backdrop = useBackdrop(onCancel);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="modal-backdrop" {...backdrop}>
      <div
        className="modal small"
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={t("removeActiveTitle", { name: record.name })}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-body">
          <h2>{t("removeActiveTitle", { name: record.name })}</h2>
          <p className="hint">{t("removeActiveBody")}</p>
          <div className="modal-actions">
            <button className="btn ghost" onClick={onCancel}>
              {t("cancel")}
            </button>
            <button className="btn" onClick={onDeactivate}>
              {t("deactivate")}
            </button>
            <button className="btn danger" onClick={onConfirm}>
              {t("uninstall")}
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
/**
 * Prévient qu'une pose va recouvrir des mods son déjà en service.
 *
 * Le jeu ne lit qu'un fichier par nom : deux mods qui livrent `masterbank.bank`
 * ne cohabitent pas sur ce fichier-là. Ça se disait jusqu'ici APRÈS coup, par
 * une notification. Le savoir avant de lancer 850 Mo de téléchargement est
 * autrement plus utile.
 *
 * Deux formulations, parce que l'écart compte : un mod qui perd quelques
 * banques continue de jouer, un mod qui les perd toutes est muet.
 */
function OverwriteWarning({ covered }: { covered: CoverReport }) {
  const { t } = useShell();
  if (!coversSomething(covered)) return null;

  const names = (list: Covered[]) => list.map((c) => c.name).join(", ");
  const total = covered.mods.filter((c) => c.total);
  const partial = covered.mods.filter((c) => !c.total);

  return (
    <div className="overwrite-warn">
      <p className="overwrite-title">{t("overwriteWarnTitle")}</p>
      {total.length > 0 && <p>{t("overwriteWarnAll", { names: names(total) })}</p>}
      {partial.length > 0 && <p>{t("overwriteWarnSome", { names: names(partial) })}</p>}
      {/* Sans nom à donner : ces banques étaient là avant l'application, ou
          viennent d'une extraction faite à la main. */}
      {covered.foreign.length > 0 && (
        <p>{t("overwriteWarnForeign", { n: covered.foreign.length })}</p>
      )}
    </div>
  );
}

/**
 * L'état d'un mod son, et le bouton qui le fait basculer.
 *
 * Un mod son est le seul contenu à avoir trois états au lieu de deux : pas
 * téléchargé, téléchargé et posé dans le jeu, téléchargé et sorti du jeu. Le
 * désactiver garde son archive, ce qui évite de refaire 850 Mo pour y revenir.
 *
 * Vit ici plutôt que dans Installés : la fiche détail le montre aussi, et
 * dupliquer la bascule aurait fait deux endroits à corriger.
 */
export function SoundState({ record }: { record: InstalledRecord }) {
  const { t, setActive, busyGroup, installed, foreignBanks } = useShell();
  const meta = soundMeta(record);
  const busy = busyGroup === record.lang_group;
  const active = isActive(record);

  // Ce que l'activation recouvrirait. Les banques sont connues sans réseau :
  // le record garde la liste de ce qu'il avait posé, et il reposera la même.
  const covered = useMemo(
    () =>
      coveredBy(
        active ? [] : meta?.files ?? [],
        installed,
        record.lang_group,
        active ? [] : foreignBanks
      ),
    [active, meta, installed, foreignBanks, record.lang_group]
  );

  return (
    <div className="sound-state">
      <p className="installed-note muted">
        <span className={active ? "dot on" : "dot"} aria-hidden="true" />
        {active ? t("soundActive") : t("soundInactive")}
        {meta ? ` · ${t("soundBankCount", { n: meta.files.length })}` : ""}
      </p>
      <OverwriteWarning covered={covered} />
      <button
        className={active ? "btn full" : "btn primary full"}
        disabled={busy}
        onClick={() => setActive(record, !active)}
      >
        {busy ? (
          <>
            <span className="spinner" /> {t(active ? "deactivating" : "activating")}
          </>
        ) : (
          t(active ? "deactivate" : "activate")
        )}
      </button>
    </div>
  );
}

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
