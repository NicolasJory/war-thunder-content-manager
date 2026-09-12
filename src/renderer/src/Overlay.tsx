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
 * Le panneau ne sait rien faire que la fenêtre principale ne sache faire : il
 * montre le véhicule courant et ses camouflages, et rien d'autre. Tout le reste
 * — recherche, filtres, viseurs, audio — reste dans l'application.
 */

import { useCallback, useEffect, useState } from "react";
import {
  api,
  skinLabel,
  thumbnail,
  type Skin,
  type Taxonomy,
  type VehicleSelection,
} from "./api";
import { IconSight } from "./icons";
import { InstallButton, useShell } from "./shell";

/** Nom lisible du véhicule, pris dans la taxonomie du filtre. */
function vehicleName(taxonomy: Taxonomy | null, id: string): string {
  return taxonomy?.vehicle?.variants?.find((v) => v.value === id)?.name ?? id;
}

export function Overlay() {
  const { t } = useShell();
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [inGame, setInGame] = useState<VehicleSelection | null>(null);
  const [skins, setSkins] = useState<Skin[] | null>(null);
  const [erreur, setErreur] = useState(false);

  useEffect(() => {
    api.content.filters("camouflage").then(setTaxonomy).catch(() => undefined);
  }, []);

  useEffect(() => {
    let alive = true;
    api.currentVehicle().then((v) => alive && setInGame(v)).catch(() => undefined);
    return api.onVehicleChange((v) => alive && setInGame(v));
  }, []);

  // Une recherche par véhicule à chaque changement. Le jeu n'écrit qu'au
  // moment où le joueur bascule, donc ça ne se déclenche pas en rafale.
  const vehicle = inGame?.current ?? null;
  useEffect(() => {
    if (!vehicle) return;
    let alive = true;
    setSkins(null);
    setErreur(false);
    api.content
      .search({ content: "camouflage", sort: "rating", vehicle })
      .then((page) => alive && setSkins(page.data.list))
      .catch(() => alive && setErreur(true));
    return () => {
      alive = false;
    };
  }, [vehicle]);

  const fermer = useCallback(() => void api.overlay.hide(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && fermer();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fermer]);

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
      ) : erreur ? (
        <p className="overlay-note">{t("E_API")}</p>
      ) : !skins ? (
        <p className="overlay-note">
          <span className="spinner" /> {t("loading")}
        </p>
      ) : skins.length === 0 ? (
        <p className="overlay-note">{t("noResults")}</p>
      ) : (
        <div className="overlay-list">
          {skins.slice(0, 12).map((skin) => (
            <article key={skin.lang_group} className="overlay-card">
              {thumbnail(skin) ? (
                <img src={thumbnail(skin)} alt="" loading="lazy" />
              ) : (
                <div className="overlay-thumb-empty" />
              )}
              <div className="overlay-card-body">
                <span className="overlay-card-title" title={skinLabel(skin)}>
                  {skinLabel(skin)}
                </span>
                <InstallButton skin={skin} block={false} />
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
