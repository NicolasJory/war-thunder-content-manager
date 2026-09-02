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

import { useCallback, useEffect, useState } from "react";
import {
  api,
  formatDate,
  formatSize,
  hasUpdate,
  type ForeignFolder,
  type InstalledRecord,
  type Skin,
} from "./api";
import { IconFolder, IconInfo } from "./icons";
import { SkinCard } from "./SkinCard";
import { useShell } from "./shell";

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

  const missing = records.filter((r) => !r.snapshot && !fetched[r.lang_group]);

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

  const bytes = records.reduce((sum, r) => sum + (r.snapshot?.file.size ?? 0), 0);
  const checked = records.reduce((max, r) => Math.max(max, r.refreshedAt ?? 0), 0);
  const updates = records.filter(hasUpdate).length;

  return (
    <div className="content">
      <div className="view-head">
        <div>
          <h2>{t("installedTitle")}</h2>
          <p>
            {records.length > 0
              ? `${t("installedCount", { n: records.length, size: formatSize(bytes, locale) })} · `
              : ""}
            {t("installedEmptyHelp")}
          </p>
        </div>

        {records.length > 0 && (
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

      {records.length === 0 ? (
        <div className="empty">
          <p className="title">{t("installedEmpty")}</p>
          <p className="muted">{t("installedEmptyHelp")}</p>
        </div>
      ) : (
        <div className="grid">
          {records.map((record) => {
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
