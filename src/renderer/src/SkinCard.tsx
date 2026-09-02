/**
 * Carte de contenu, partagée par la recherche, la page auteur et les installés.
 *
 * L'action est posée SUR la vignette, comme au canvas : elle ne consomme pas de
 * hauteur sous la carte, et pendant une installation la barre de progression
 * prend exactement sa place.
 */

import { useState } from "react";
import { formatCount, formatSize, skinLabel, tagsOf, thumbnail, type Skin } from "./api";
import { InstallButton, useShell } from "./shell";

export function SkinCard({
  skin,
  page,
  onOpen,
  onTag,
  onAuthor,
  onHover,
  onHoverEnd,
}: {
  skin: Skin;
  /** Numéro de page d'où vient la carte : lu du DOM par l'étiquette flottante. */
  page?: number;
  onOpen: () => void;
  onTag: (tag: string) => void;
  onAuthor?: (skin: Skin) => void;
  onHover?: (skin: Skin, el: HTMLElement) => void;
  onHoverEnd?: () => void;
}) {
  const { t, locale, busyId, busyGroup } = useShell();
  const tags = tagsOf(skin);
  const busy = busyId === skin.id || busyGroup === skin.lang_group;

  return (
    <article className="card" data-page={page}>
      <div
        className="thumb"
        onMouseEnter={(e) => onHover?.(skin, e.currentTarget)}
        onMouseLeave={onHoverEnd}
      >
        <button className="card-open" onClick={onOpen} aria-label={skinLabel(skin)}>
          {thumbnail(skin) ? (
            <img src={thumbnail(skin)} alt="" loading="lazy" />
          ) : (
            <div className="thumb-empty">{t("noPreview")}</div>
          )}
        </button>

        {skin.images.length > 1 && !busy && (
          <span className="badge">{t("imageCount", { n: skin.images.length })}</span>
        )}

        <div className={busy ? "thumb-progress" : "thumb-action"}>
          <InstallButton skin={skin} block={busy} />
        </div>
      </div>

      <div className="card-body">
        <button className="card-open" onClick={onOpen}>
          <h3 className="card-title" title={skinLabel(skin)}>
            {skinLabel(skin)}
          </h3>
        </button>

        <div className="byline">
          <Avatar author={skin.author} />
          {onAuthor ? (
            <button className="link author" onClick={() => onAuthor(skin)} title={skin.author.nickname}>
              {skin.author.nickname}
            </button>
          ) : (
            <span className="author-name" title={skin.author.nickname}>
              {skin.author.nickname}
            </span>
          )}
          {/* Le poids était enfermé dans le bloc de tags : les contenus sans
              hashtag ne l'affichaient donc jamais. Il appartient aux compteurs. */}
          <span className="counts">
            <span>♥ {formatCount(skin.likes, locale)}</span>
            <span>↓ {formatCount(skin.downloads, locale)}</span>
            <span className="size">{formatSize(skin.file.size, locale)}</span>
          </span>
        </div>

        {tags.length > 0 && (
          <div className="tags">
            {tags.slice(0, 4).map((tag) => (
              <button key={tag} className="tag" onClick={() => onTag(tag)}>
                #{tag}
              </button>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

/**
 * Avatar rond. Live sert une image par défaut pour les comptes sans photo ; si
 * elle échoue, on retombe sur l'initiale plutôt que sur une image cassée.
 */
export function Avatar({ author, large }: { author: Skin["author"]; large?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = large ? "avatar lg" : "avatar";
  if (!author.avatar || broken) {
    return (
      <span className={`${cls} fallback`} aria-hidden="true">
        {author.nickname.trim().charAt(0).toUpperCase() || "?"}
      </span>
    );
  }
  return (
    <img
      className={cls}
      src={author.avatar}
      alt=""
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

export function CardSkeletons({ count = 12 }: { count?: number }) {
  return (
    <div className="grid">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card skeleton" />
      ))}
    </div>
  );
}
