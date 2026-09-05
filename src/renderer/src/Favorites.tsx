/**
 * Auteurs mis en favori, et ce qu'ils ont publié en dernier.
 *
 * La liste vit dans la config plutôt que dans le stockage du navigateur :
 * elle survit à un vidage de cache et se retrouvera dans une sauvegarde.
 *
 * Le fil du haut évite d'ouvrir dix pages d'auteur pour savoir s'il y a du
 * neuf. Il coûte une requête par favori contre une API non officielle, donc
 * il se demande : c'est un bouton, pas un chargement automatique.
 */

import { useCallback, useState } from "react";
import { api, formatDate, type FavoriteAuthor, type Skin } from "./api";
import { IconSearch } from "./icons";
import { Avatar, SkinCard } from "./SkinCard";
import { useShell } from "./shell";

/** Assez pour voir les nouveautés, assez peu pour rester lisible. */
const FEED_MAX = 24;
/** Sans ce plafond, un auteur prolifique occupe tout le fil et les autres
    favoris n'apparaissent pas du tout. */
const PER_AUTHOR = 6;
/** Espacement entre deux auteurs : on interroge un service qu'on ne paie pas. */
const SPACING_MS = 350;

export function Favorites({
  favorites,
  onOpen,
  onSkin,
  onTag,
  onAuthor,
}: {
  favorites: FavoriteAuthor[];
  onOpen: (author: FavoriteAuthor) => void;
  onSkin: (skin: Skin) => void;
  onTag: (tag: string) => void;
  onAuthor: (skin: Skin) => void;
}) {
  const { t, locale, content, notify } = useShell();
  const [feed, setFeed] = useState<Skin[] | null>(null);
  const [loading, setLoading] = useState(0);

  const loadFeed = useCallback(async () => {
    setLoading(1);
    const seen = new Map<number, Skin>();
    let failed = 0;
    for (const [i, f] of favorites.entries()) {
      setLoading(i + 1);
      try {
        const page = await api.content.userPage({ user: f.id, content, sort: "created" });
        // La page arrive déjà du plus récent au plus ancien : les premiers
        // suffisent. La clé de regroupement dédoublonne un même contenu publié
        // en plusieurs langues.
        let kept = 0;
        for (const skin of page.data.list) {
          if (kept >= PER_AUTHOR) break;
          if (seen.has(skin.lang_group)) continue;
          seen.set(skin.lang_group, skin);
          kept++;
        }
      } catch {
        // Un auteur supprimé ou une coupure ne doit pas vider le fil entier.
        failed++;
      }
      if (i < favorites.length - 1) await new Promise((r) => setTimeout(r, SPACING_MS));
    }
    setFeed([...seen.values()].sort((a, b) => b.created - a.created).slice(0, FEED_MAX));
    setLoading(0);
    if (failed) notify(t("favFeedPartial", { n: failed, total: favorites.length }), "err");
  }, [favorites, content, notify, t]);

  if (favorites.length === 0) {
    return (
      <div className="content">
        <div className="empty">
          <p className="title">{t("favoritesEmpty")}</p>
          <p className="muted">{t("favoritesHelp")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="content">
      <div className="view-head">
        <div>
          <h2>{t("favorites")}</h2>
          <p>{t("favoritesHelp")}</p>
        </div>
      </div>

      <section className="fav-feed">
        <div className="more-head">
          <h3>{t("favFeedTitle")}</h3>
          {loading > 0 ? (
            <span className="muted">
              <span className="spinner" /> {t("favFeedLoading", { n: loading, total: favorites.length })}
            </span>
          ) : (
            <button className="btn" onClick={loadFeed}>
              {feed ? t("refresh") : t("favFeedLoad")}
            </button>
          )}
        </div>

        {feed === null ? (
          <p className="muted foreign-help">{t("favFeedHelp")}</p>
        ) : feed.length === 0 ? (
          <p className="muted foreign-help">{t("favFeedEmpty")}</p>
        ) : (
          <div className="grid">
            {feed.map((skin) => (
              <SkinCard
                key={skin.lang_group}
                skin={skin}
                onOpen={() => onSkin(skin)}
                onTag={onTag}
                onAuthor={onAuthor}
              />
            ))}
          </div>
        )}
      </section>

      <div className="more-head">
        <h3>{t("favAuthorsTitle")}</h3>
        <span className="muted">{favorites.length}</span>
      </div>

      <ul className="fav-grid">
        {[...favorites]
          .sort((a, b) => b.addedAt - a.addedAt)
          .map((f) => (
            <li key={f.id}>
              <button className="fav-card" onClick={() => onOpen(f)}>
                <Avatar author={f} large />
                <span className="fav-text">
                  <strong>{f.nickname}</strong>
                  <span className="muted">
                    {t("addedOn", { date: formatDate(Math.round(f.addedAt / 1000), locale) })}
                  </span>
                </span>
                <IconSearch size={15} />
              </button>
            </li>
          ))}
      </ul>
    </div>
  );
}
