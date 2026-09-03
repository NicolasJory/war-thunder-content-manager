/**
 * Toutes les créations d'un auteur.
 *
 * Passe par get_user, dont les contraintes sont documentées dans wtLive :
 * l'ID numérique est obligatoire, `content` est refusé, et le feed mélange
 * captures et vidéos non installables — le filtrage se fait donc côté main.
 * Conséquence visible ici : une page peut contenir moins de 25 camouflages,
 * donc on ne prétend pas afficher un total.
 */

import { useRef, useState } from "react";
import { api, authorUrl, SORTS, type Skin, type SortKey } from "./api";
import { LoadMore, PageBadge, useInfiniteFeed } from "./feed";
import { HoverPreview, useHoverTarget } from "./HoverPreview";
import { Avatar, CardSkeletons, SkinCard } from "./SkinCard";
import { ExternalLink, useShell } from "./shell";

export function AuthorView({
  author,
  isFavorite,
  onToggleFavorite,
  onBack,
  onOpen,
  onTag,
}: {
  author: { id: number; nickname: string; avatar: string };
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onBack: () => void;
  onOpen: (skin: Skin) => void;
  onTag: (tag: string) => void;
}) {
  const { t, content } = useShell();
  const [sort, setSort] = useState<SortKey>("created");
  const gridRef = useRef<HTMLDivElement>(null);
  const hover = useHoverTarget();

  // `stopOnEmpty` : le filtrage par type peut vider une page pleine sans que ce
  // soit la derniere, donc seule une page vraiment vide arrete le defilement.
  const feed = useInfiniteFeed(
    JSON.stringify([content, author.id, sort]),
    (page) =>
      api.content
        .userPage({ user: author.id, content, sort, page })
        .then((p) => p.data.list),
    { stopOnEmpty: true }
  );

  return (
    <div className="content">
      <div className="author-bar">
        <button className="btn ghost" onClick={onBack}>
          ‹ {t("backToBrowse")}
        </button>
      </div>

      {/* Deux rangées : l'identité tient la première, les actions la seconde.
          Tout aligner sur une seule ligne mettait le libellé du tri au-dessus
          de son menu, désaxé par rapport au reste. */}
      <div className="author-head">
        <div className="author-id">
          <Avatar author={author} large />
          <div className="author-name">
            <span className="eyebrow">{t("contentCamouflages")}</span>
            <h2>{author.nickname}</h2>
          </div>
        </div>

        <div className="author-actions">
          <label className="combo author-sort">
            <span className="field-label">{t("sortBy")}</span>
            <select
              className="select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
            >
              {SORTS.map((so) => (
                <option key={so.value} value={so.value}>
                  {t(so.key)}
                </option>
              ))}
            </select>
          </label>

          <button
            className={isFavorite ? "btn primary" : "btn"}
            onClick={onToggleFavorite}
            aria-pressed={isFavorite}
          >
            {isFavorite ? "★" : "☆"} {isFavorite ? t("removeFavorite") : t("addFavorite")}
          </button>

          <ExternalLink href={authorUrl(author.nickname)}>{t("viewOnLive")}</ExternalLink>
        </div>
      </div>

      <p className="muted result-note">{t("authorNote")}</p>

      {feed.error && feed.items.length === 0 ? (
        <div className="empty">
          <p className="error">{feed.error}</p>
          <button className="btn" onClick={feed.retry}>
            {t("retry")}
          </button>
        </div>
      ) : feed.loading ? (
        <CardSkeletons count={8} />
      ) : feed.items.length === 0 ? (
        <div className="empty">
          <p>{t("authorEmpty")}</p>
        </div>
      ) : (
        <>
          <div className="grid" ref={gridRef}>
            {feed.items.map((skin, i) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                page={feed.pageOf[i]}
                onOpen={() => onOpen(skin)}
                onTag={onTag}
                onHover={hover.enter}
                onHoverEnd={hover.leave}
              />
            ))}
          </div>

          <LoadMore onReach={feed.loadMore} disabled={feed.done || feed.appending} />

          {feed.appending && (
            <p className="loading-inline feed-foot">
              <span className="spinner" /> {t("loading")}
            </p>
          )}
          {feed.error && (
            <p className="feed-foot">
              <span className="error">{feed.error}</span>{" "}
              <button className="link" onClick={feed.retry}>
                {t("retry")}
              </button>
            </p>
          )}
          {feed.done && <p className="muted feed-foot">{t("endOfList")}</p>}

          <PageBadge gridRef={gridRef} total={feed.items.length} />
          <HoverPreview target={hover.target} />
        </>
      )}
    </div>
  );
}
