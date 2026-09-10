/**
 * Contenus installés, présentés comme dans la recherche.
 *
 * Chaque enregistrement porte un instantané du post pris au moment de
 * l'installation : la vue s'affiche donc instantanément, sans réseau, et
 * fonctionne hors ligne. Le rafraîchissement est explicite plutôt
 * qu'automatique — c'est une requête par contenu installé contre une API non
 * officielle, ça se demande.
 *
 * La section du bas liste les dossiers que l'application n'a PAS posés. Ils
 * étaient jusqu'ici invisibles alors qu'un joueur veut les voir ; ils restent
 * en lecture seule, c'est le contrat.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  formatDate,
  formatSize,
  hasUpdate,
  isActive,
  skinLabel,
  soundMeta,
  type ForeignFolder,
  type InstalledRecord,
  type Skin,
} from "./api";
import { IconClose, IconFolder, IconInfo } from "./icons";
import { SkinCard } from "./SkinCard";
import { useShell } from "./shell";

/** Une bibliotheque se range par date, par nom ou par poids : rien d'autre. */
const SORTS = [
  { value: "recent", key: "sortInstalledAt" },
  { value: "name", key: "sortAZ" },
  { value: "size", key: "sortHeaviest" },
] as const;

type InstalledSort = (typeof SORTS)[number]["value"];

/** En dessous, tout tient a l'ecran : la barre encombrerait plus qu'elle n'aide. */
const TOOLBAR_FROM = 6;

/** Chaque type se range sous son propre titre, dans l'ordre de la nav. */
const GROUPS = [
  { type: "camouflage", titleKey: "contentCamouflages" },
  { type: "sight", titleKey: "navSights" },
  { type: "sound", titleKey: "navSounds" },
] as const;

/** Un fichier sight est `<vehicule>/<fichier>.blk` : le compte se lit dans le chemin. */
function vehicleCount(record: InstalledRecord): number {
  const files = (record.meta?.files as string[] | undefined) ?? [];
  return new Set(files.map((f) => f.split("/")[0])).size;
}

export function Installed({
  records,
  onRecords,
  onOpen,
  onAuthor,
}: {
  records: InstalledRecord[];
  onRecords: (records: InstalledRecord[]) => void;
  onOpen: (skin: Skin) => void;
  onAuthor: (skin: Skin) => void;
}) {
  const { t, locale, notify, tError, requestInstall } = useShell();
  const [fetched, setFetched] = useState<Record<number, Skin>>({});
  const [busy, setBusy] = useState(false);
  const [foreign, setForeign] = useState<ForeignFolder[]>([]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<InstalledSort>("recent");

  // Le disque, lui, se relit sans coût réseau : on le fait à chaque ouverture.
  useEffect(() => {
    let alive = true;
    api.content
      .foreign()
      .then((list) => alive && setForeign(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [records.length]);

  // Tous les types de contenu ensemble : la distinction se voit sur chaque
  // carte, pas via un filtre qui viderait la vue selon l'onglet Parcourir actif.
  const shown = records;

  const missing = shown.filter((r) => !r.snapshot && !fetched[r.lang_group]);

  useEffect(() => {
    if (missing.length === 0) return;
    let alive = true;
    (async () => {
      for (const record of missing) {
        if (!alive) return;
        try {
          const skin = await api.content.post(record.lang_group);
          if (!alive) return;
          setFetched((prev) => ({ ...prev, [record.lang_group]: skin }));
        } catch {
          // Contenu supprimé de Live, ou réseau absent : la ligne de repli
          // reste affichée et reste désinstallable.
        }
        await new Promise((r) => setTimeout(r, 350));
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing.map((r) => r.lang_group).join(",")]);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      onRecords(await api.content.refreshInstalled());
    } catch (e) {
      notify(tError((e as Error).message), "err");
    } finally {
      setBusy(false);
    }
  }, [onRecords, notify, tError]);

  // Filtre et tri se calculent sur ce qu'on sait afficher : le nom du dossier
  // choisi par le joueur, plus le titre et l'auteur quand l'instantane est la.
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const kept = needle
      ? shown.filter((r) => {
          const skin = r.snapshot ?? fetched[r.lang_group];
          const hay = [r.name, skin ? skinLabel(skin) : "", skin?.author.nickname ?? ""];
          return hay.some((h) => h.toLowerCase().includes(needle));
        })
      : shown;
    const sizeOf = (r: InstalledRecord) => r.snapshot?.file.size ?? 0;
    return [...kept].sort((a, b) =>
      sort === "name"
        ? a.name.localeCompare(b.name, locale)
        : sort === "size"
          ? sizeOf(b) - sizeOf(a)
          : b.installedAt - a.installedAt
    );
  }, [shown, fetched, filter, sort, locale]);

  const bytes = shown.reduce((sum, r) => sum + (r.snapshot?.file.size ?? 0), 0);
  const checked = shown.reduce((max, r) => Math.max(max, r.refreshedAt ?? 0), 0);
  const updates = shown.filter(hasUpdate).length;

  return (
    <div className="content">
      <div className="view-head">
        <div>
          <h2>{t("installedTitle")}</h2>
          <p>
            {shown.length > 0
              ? `${t("installedCount", { n: shown.length, size: formatSize(bytes, locale) })} · `
              : ""}
            {/* Sans ce rappel, l'en-tete annonce le total pendant qu'un filtre
                n'en montre que deux. */}
            {visible.length !== shown.length
              ? `${t("filterMatches", { n: visible.length })} · `
              : ""}
            {t("installedEmptyHelp")}
          </p>
        </div>

        {shown.length > 0 && (
          <div className="head-actions">
            <span className="muted checked">
              {t("lastChecked", {
                date: checked ? formatDate(Math.round(checked / 1000), locale) : t("never"),
              })}
            </span>
            <button className="btn" onClick={refresh} disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner" /> {t("refreshing")}
                </>
              ) : (
                t("refresh")
              )}
            </button>
          </div>
        )}
      </div>

      {updates > 0 && (
        <p className="banner">
          <IconInfo size={14} />
          {t("updateAvailable")} · {updates}
        </p>
      )}

      {shown.length >= TOOLBAR_FROM && (
        <div className="toolbar compact">
          <label className="combo">
            <span className="field-label">{t("search")}</span>
            <div className="combo-field">
              <input
                className={filter ? "input set" : "input"}
                value={filter}
                placeholder={t("filterInstalled")}
                onChange={(e) => setFilter(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setFilter("")}
                spellCheck={false}
              />
              {filter && (
                <button
                  className="combo-clear"
                  onClick={() => setFilter("")}
                  aria-label={t("clearSearch")}
                  title={t("clearSearch")}
                >
                  <IconClose size={10} />
                </button>
              )}
            </div>
          </label>

          <label className="combo">
            <span className="field-label">{t("sortBy")}</span>
            <select
              className="select"
              value={sort}
              onChange={(e) => setSort(e.target.value as InstalledSort)}
            >
              {SORTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.key)}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {shown.length === 0 ? (
        <div className="empty">
          <p className="title">{t("installedEmpty")}</p>
          <p className="muted">{t("installedEmptyHelp")}</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="empty">
          <p className="title">{t("noResults")}</p>
          <p className="muted">{t("filterNoMatch", { term: filter.trim() })}</p>
        </div>
      ) : (
        GROUPS.map(({ type, titleKey }) => {
          const items = visible.filter((r) => r.contentType === type);
          if (items.length === 0) return null;
          return (
            <section key={type} className="installed-group">
              <div className="more-head">
                <h3>{t(titleKey)}</h3>
                <span className="muted">{items.length}</span>
              </div>
              <div className="grid">
                {items.map((record) => {
                  const skin = record.snapshot ?? fetched[record.lang_group];
                  return skin ? (
                    <div key={record.lang_group} className="installed-card">
                      <SkinCard
                        skin={skin}
                        onOpen={() => onOpen(skin)}
                        onTag={() => undefined}
                        onAuthor={onAuthor}
                      />
                      <p className="installed-note muted">
                        {t("folderName")} : <code>{record.name}</code>
                      </p>
                      {record.contentType === "sight" && (
                        <p className="installed-note muted">
                          {t("sightVehicleCount", { n: vehicleCount(record) })}
                        </p>
                      )}
                      {record.contentType === "sound" && <SoundState record={record} />}
                      {hasUpdate(record) && (
                        <button className="btn primary update" onClick={() => requestInstall(skin)}>
                          {t("updateNow")}
                        </button>
                      )}
                    </div>
                  ) : (
                    <FallbackCard key={record.lang_group} record={record} />
                  );
                })}
              </div>
            </section>
          );
        })
      )}

      {foreign.length > 0 && (
        <section className="foreign">
          <div className="more-head">
            <h3>{t("foreignTitle")}</h3>
            <span className="muted">{t("foreignCount", { n: foreign.length })}</span>
          </div>
          <p className="muted foreign-help">{t("foreignHelp")}</p>
          <ul className="foreign-list">
            {foreign.map((f) => (
              <li key={f.path} className="foreign-item" title={f.path}>
                <IconFolder size={14} />
                <span className="foreign-name">{f.name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * Sans instantané ni réponse de Live, on affiche au moins ce qu'on sait de
 * source sûre : le dossier posé sur le disque. Il reste désinstallable, ce qui
 * est l'essentiel.
 */
function FallbackCard({ record }: { record: InstalledRecord }) {
  const { t, locale, uninstall, busyGroup } = useShell();
  const removing = busyGroup === record.lang_group;

  return (
    <article className="card">
      <div className="thumb">
        <div className="thumb-empty">{t("noPreview")}</div>
      </div>
      <div className="card-body">
        <h3 className="card-title" title={record.name}>
          {record.name}
        </h3>
        <div className="byline">
          <span className="author-name">
            {t("installedOn")} {formatDate(Math.round(record.installedAt / 1000), locale)}
          </span>
        </div>
        <span className="path">{record.path}</span>
        <button className="btn danger full" onClick={() => uninstall(record)} disabled={removing}>
          {removing ? (
            <>
              <span className="spinner" /> {t("uninstalling")}
            </>
          ) : (
            t("uninstall")
          )}
        </button>
      </div>
    </article>
  );
}

/**
 * L'état d'un mod son, et le bouton qui le fait basculer.
 *
 * Un mod son est le seul contenu à avoir trois états au lieu de deux : pas
 * téléchargé, téléchargé et posé dans le jeu, téléchargé et sorti du jeu. Le
 * désactiver garde son archive, ce qui évite de refaire 850 Mo pour y revenir.
 */
function SoundState({ record }: { record: InstalledRecord }) {
  const { t, setActive, busyGroup } = useShell();
  const meta = soundMeta(record);
  const busy = busyGroup === record.lang_group;
  const active = isActive(record);

  return (
    <div className="sound-state">
      <p className="installed-note muted">
        <span className={active ? "dot on" : "dot"} aria-hidden="true" />
        {active ? t("soundActive") : t("soundInactive")}
        {meta ? ` · ${t("soundBankCount", { n: meta.files.length })}` : ""}
      </p>
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
