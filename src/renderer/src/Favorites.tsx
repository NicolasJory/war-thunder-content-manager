/**
 * Auteurs mis en favori.
 *
 * La liste vit dans la config plutôt que dans le stockage du navigateur :
 * elle survit à un vidage de cache et se retrouvera dans une sauvegarde. Un
 * clic ouvre la page de l'auteur, triée sur les publications récentes — c'est
 * ce qu'on vient y chercher.
 */

import { formatDate, type FavoriteAuthor } from "./api";
import { IconSearch } from "./icons";
import { Avatar } from "./SkinCard";
import { useShell } from "./shell";

export function Favorites({
  favorites,
  onOpen,
}: {
  favorites: FavoriteAuthor[];
  onOpen: (author: FavoriteAuthor) => void;
}) {
  const { t, locale } = useShell();

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
