/**
 * Panneau flottant : les camouflages du véhicule que le joueur a sous les yeux.
 *
 * Ce n'est PAS un overlay injecté. C'est une fenêtre Electron ordinaire, posée
 * au-dessus du jeu, qui n'approche jamais son processus — ni DLL, ni hook du
 * présent graphique, ni lecture mémoire. War Thunder tourne sous BattlEye et
 * ces trois gestes sont exactement ce qu'il sanctionne ; une fenêtre de plus à
 * l'écran ne le concerne pas, pas plus que le navigateur ouvert à côté.
 *
 * Contrepartie assumée : ça ne s'affiche qu'en plein écran fenêtré. Le plein
 * écran exclusif reprend la surface à toutes les autres fenêtres, et rien
 * d'inoffensif ne contourne ça.
 *
 * Les cartes, le défilement infini et le bouton d'installation sont ceux de
 * l'application : le panneau n'en a pas de copie, il change juste de fenêtre.
 * Ouvrir une fiche ramène la fenêtre principale — une fiche détaillée dans une
 * colonne de quatre cents pixels ne rendrait service à personne.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Skin, type Taxonomy, type VehicleSelection } from "./api";
import { LoadMore, PageBadge, useInfiniteFeed } from "./feed";
import { IconSight } from "./icons";
import { SkinCard } from "./SkinCard";
import { useShell } from "./shell";

/** Nom lisible du véhicule, pris dans la taxonomie du filtre. */
function vehicleName(taxonomy: Taxonomy | null, id: string): string {
  return taxonomy?.vehicle?.variants?.find((v) => v.value === id)?.name ?? id;
}

export function Overlay() {
  const { t } = useShell();
  const gridRef = useRef<HTMLDivElement>(null);
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [inGame, setInGame] = useState<VehicleSelection | null>(null);

  useEffect(() => {
    api.content.filters("camouflage").then(setTaxonomy).catch(() => undefined);
  }, []);

  useEffect(() => {
    let alive = true;
    api.currentVehicle().then((v) => alive && setInGame(v)).catch(() => undefined);
    return api.onVehicleChange((v) => alive && setInGame(v));
  }, []);

  const vehicle = inGame?.current ?? null;

  // Le même défilement infini que la recherche : changer de véhicule ouvre une
  // nouvelle génération et jette les réponses de la précédente.
  const feed = useInfiniteFeed(vehicle ?? "", (page) =>
    vehicle
      ? api.content
          .search({ content: "camouflage", sort: "rating", vehicle, page })
          .then((p) => p.data.list)
      : Promise.resolve([])
  );

  const fermer = useCallback(() => void api.overlay.hide(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && fermer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fermer]);

  /** La fiche s'ouvre dans la fenêtre principale, qui a la place de l'afficher. */
  const ouvrir = useCallback((skin: Skin) => {
    void api.overlay.openInMain(skin.lang_group);
  }, []);

  return (
    <div className="overlay">
      <div className="overlay-head">
        <IconSight size={14} />
        <span className="overlay-title">
          {vehicle ? vehicleName(taxonomy, vehicle) : t("overlayNoVehicle")}
        </span>
        <button className="btn ghost overlay-close" onClick={fermer} aria-label={t("close")}>
          ✕
        </button>
      </div>

      {!vehicle ? (
        <p className="overlay-note">{t("overlayNoVehicleHelp")}</p>
      ) : feed.error && feed.items.length === 0 ? (
        <div className="overlay-note">
          <p>{feed.error}</p>
          <button className="btn" onClick={feed.retry}>
            {t("retry")}
          </button>
        </div>
      ) : feed.loading ? (
        <p className="overlay-note">
          <span className="spinner" /> {t("loading")}
        </p>
      ) : feed.items.length === 0 ? (
        <p className="overlay-note">{t("noResults")}</p>
      ) : (
        <div className="overlay-scroll">
          <div className="grid overlay-grid" ref={gridRef}>
            {feed.items.map((skin, i) => (
              <SkinCard
                key={`${skin.lang_group}-${i}`}
                skin={skin}
                page={feed.pageOf[i]}
                onOpen={() => ouvrir(skin)}
                onTag={() => undefined}
              />
            ))}
          </div>
          <LoadMore onReach={feed.loadMore} disabled={feed.done || feed.appending} />
          {feed.appending && (
            <p className="overlay-note">
              <span className="spinner" /> {t("loading")}
            </p>
          )}
          <PageBadge gridRef={gridRef} total={feed.items.length} />
        </div>
      )}
    </div>
  );
}
