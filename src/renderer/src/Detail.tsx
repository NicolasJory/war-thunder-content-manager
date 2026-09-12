/**
 * Fiche détail — deux colonnes, d'après la maquette.
 *
 * L'image occupe toute la hauteur à gauche, le panneau de droite porte les
 * informations et les actions. La galerie ne coûte aucune requête : tout vient
 * de la réponse de liste, et les URLs haute résolution se déduisent des
 * vignettes (voir hiRes).
 *
 * La maquette remplace le carrousel inline par un bouton « Autres créations » :
 * un appel réseau de moins à chaque ouverture, et la page auteur fait déjà ce
 * travail en mieux.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  formatCount,
  formatDate,
  hiRes,
  imagesOf,
  liveUrl,
  descriptionParts,
  skinLabel,
  tagsOf,
  type Skin,
} from "./api";
import { IconChevronLeft, IconChevronRight, IconClose } from "./icons";
import { Avatar } from "./SkinCard";
import { InstallButton, SoundState, useShell } from "./shell";
import { useBackdrop } from "./useBackdrop";
import { useFocusTrap } from "./useFocusTrap";
import { appUrl, shareUrl } from "../../shared/deepLink";

interface Props {
  skin: Skin;
  onTag: (tag: string) => void;
  onAuthor: (skin: Skin) => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  onClose: () => void;
}

export function Detail({ skin, onTag, onAuthor, isFavorite, onToggleFavorite, onClose }: Props) {
  const { t, locale, openExternal, copy, recordFor } = useShell();
  const record = recordFor(skin.lang_group);
  const backdrop = useBackdrop(onClose);
  const images = imagesOf(skin);
  const [index, setIndex] = useState(0);
  const [fallback, setFallback] = useState<Record<number, boolean>>({});
  const [loaded, setLoaded] = useState<Record<number, boolean>>({});
  // Zoom : facteur + décalage, en pixels de la zone. 1 = ajusté au cadre.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const viewRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  useFocusTrap(sheetRef);
  const tags = tagsOf(skin);
  const parts = descriptionParts(skin);

  const resetZoom = useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    setIndex(0);
    setFallback({});
    setLoaded({});
    resetZoom();
  }, [skin.id, resetZoom]);

  // Changer d'image repart d'un cadrage neutre.
  useEffect(resetZoom, [index, resetZoom]);

  /**
   * Molette : zoom centré sur le pointeur, pour que le détail visé reste sous
   * le curseur. Sans ça, zoomer déplace ce qu'on regarde et il faut repanner.
   *
   * Listener natif NON passif, et pas `onWheel` de React : React enregistre
   * `wheel` en passif au niveau de la racine, ce qui rend `preventDefault()`
   * inopérant — la molette zoomait ET faisait défiler la liste derrière.
   */
  useEffect(() => {
    const el = viewRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const box = el.getBoundingClientRect();
      setZoom((z) => {
        const next = Math.min(6, Math.max(1, z * (e.deltaY < 0 ? 1.18 : 1 / 1.18)));
        if (next === z) return z;
        if (next === 1) {
          setPan({ x: 0, y: 0 });
          return 1;
        }
        const cx = e.clientX - box.left - box.width / 2;
        const cy = e.clientY - box.top - box.height / 2;
        const k = next / z;
        setPan((p) => ({ x: cx - (cx - p.x) * k, y: cy - (cy - p.y) * k }));
        return next;
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Tant que la fiche est ouverte, la liste derrière ne défile pas : sinon on
  // perd sa position en manipulant l'image.
  useEffect(() => {
    const before = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = before;
    };
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowRight") setIndex((i) => Math.min(i + 1, images.length - 1));
      if (e.key === "ArrowLeft") setIndex((i) => Math.max(i - 1, 0));
      if (e.key === "+" || e.key === "=") setZoom((z) => Math.min(6, z * 1.3));
      if (e.key === "-") setZoom((z) => Math.max(1, z / 1.3));
      if (e.key === "0") resetZoom();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, images.length, resetZoom]);

  const current = images[index] ?? "";

  return (
    <div className="modal-backdrop" {...backdrop}>
      <div
        className="sheet"
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={skinLabel(skin)}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---------------- Colonne image ---------------- */}
        <div
          className={zoom > 1 ? "sheet-view zoomed" : "sheet-view"}
          ref={viewRef}
          onDoubleClick={() => (zoom > 1 ? resetZoom() : setZoom(2.5))}
          onPointerDown={(e) => {
            // Uniquement depuis l'image : démarrer la capture depuis n'importe
            // où avalait les clics sur les flèches et les tirets, qui
            // devenaient inutilisables dès qu'on avait zoomé.
            if (zoom === 1 || !(e.target as HTMLElement).classList.contains("sheet-image")) return;
            drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const d = drag.current;
            if (!d) return;
            setPan({ x: d.px + (e.clientX - d.x), y: d.py + (e.clientY - d.y) });
          }}
          onPointerUp={() => (drag.current = null)}
          onPointerCancel={() => (drag.current = null)}
        >
          {current ? (
            <>
              {!loaded[index] && <span className="spinner lg gallery-spinner" />}
              <img
                className={loaded[index] ? "sheet-image" : "sheet-image pending"}
                style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}
                draggable={false}
                src={fallback[index] ? current : hiRes(current)}
                alt=""
                onLoad={() => setLoaded((l) => ({ ...l, [index]: true }))}
                onError={() => {
                  if (!fallback[index]) setLoaded((l) => ({ ...l, [index]: false }));
                  setFallback((f) => ({ ...f, [index]: true }));
                }}
              />
            </>
          ) : (
            <span className="sheet-placeholder">
              {t("imagePosition", { n: index + 1, total: Math.max(images.length, 1) })}
            </span>
          )}

          {zoom > 1 && (
            <button className="zoom-reset" onClick={resetZoom}>
              {Math.round(zoom * 100)} % · {t("resetZoom")}
            </button>
          )}

          {images.length > 1 && (
            <>
              <button
                className="round-nav prev"
                onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                disabled={index === 0}
                aria-label={t("previousImage")}
              >
                <IconChevronLeft size={13} />
              </button>
              <button
                className="round-nav next"
                onClick={() => setIndex((i) => Math.min(i + 1, images.length - 1))}
                disabled={index === images.length - 1}
                aria-label={t("nextImage")}
              >
                <IconChevronRight size={13} />
              </button>

              {/* Tirets plutôt qu'une bande de miniatures : la maquette garde
                  l'image entière et ne montre que la position. */}
              <div className="dashes">
                {images.map((_, i) => (
                  <button
                    key={i}
                    className={i === index ? "dash active" : "dash"}
                    onClick={() => setIndex(i)}
                    aria-label={t("imagePosition", { n: i + 1, total: images.length })}
                    aria-current={i === index}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ---------------- Panneau ---------------- */}
        <div className="sheet-panel">
          <div className="sheet-head">
            <h2>{skinLabel(skin)}</h2>
            <button className="sheet-close" onClick={onClose} aria-label={t("close")}>
              <IconClose size={12} />
            </button>
          </div>

          <div className="sheet-author">
            <Avatar author={skin.author} />
            <button className="link author" onClick={() => onAuthor(skin)}>
              {skin.author.nickname}
            </button>
            {/* Le poids a migré dans le libellé du bouton d'installation :
                cette place sert mieux à mettre l'auteur en favori sans avoir à
                passer par sa page. */}
            <button
              className={isFavorite ? "fav-toggle on" : "fav-toggle"}
              onClick={onToggleFavorite}
              aria-pressed={isFavorite}
              title={isFavorite ? t("removeFavorite") : t("addFavorite")}
            >
              {isFavorite ? "★" : "☆"}
              <span className="sr-only">{t("favorite")}</span>
            </button>
          </div>

          <div className="sheet-stats">
            <Stat value={skin.likes} label={t("likes")} locale={locale} />
            <Stat value={skin.downloads} label={t("downloads")} locale={locale} />
            <Stat value={skin.views} label={t("views")} locale={locale} />
            <Stat value={skin.comments} label={t("comments")} locale={locale} />
          </div>

          {tags.length > 0 && (
            <div className="tags">
              {tags.map((tag) => (
                <button key={tag} className="tag" onClick={() => onTag(tag)}>
                  #{tag}
                </button>
              ))}
            </div>
          )}

          {/* Zone souple : la description pousse le pied vers le bas quand elle
              est courte, et défile quand elle est longue. */}
          <div className="sheet-scroll">
            {parts.length > 0 && (
              <p className="description">
                {parts.map((part, i) =>
                  part.tag ? (
                    // Un hashtag reste DANS l'app : il remplit le champ de
                    // recherche au lieu d'ouvrir le navigateur.
                    <button key={i} className="link inline" onClick={() => onTag(part.tag!)}>
                      {part.text}
                    </button>
                  ) : part.href ? (
                    // Un lien externe passe par la même confirmation que les
                    // autres : rien ne sort de l'app sans un oui explicite.
                    <button key={i} className="link inline" onClick={() => openExternal(part.href!)}>
                      {part.text}
                    </button>
                  ) : (
                    <span key={i}>{part.text}</span>
                  )
                )}
              </p>
            )}
            <p className="sheet-date muted">{t("uploadedOn", { date: formatDate(skin.created, locale) })}</p>
          </div>

          <div className="sheet-foot">
            <p className="sheet-note">{t("localOnly")}</p>
            {/* Un mod son installé peut sortir du jeu sans être supprimé : la
                bascule passe avant la désinstallation, qui reste définitive. */}
            {record?.contentType === "sound" && <SoundState record={record} />}
            <InstallButton skin={skin} withSize />
            <div className="sheet-actions">
              {/* Le lien partagé est l'URL publique : elle marche pour tout le
                  monde, avec ou sans l'application. Le lien app est proposé à
                  part, pour ceux qui l'ont installée. */}
              <button
                className="btn"
                onClick={() => copy(shareUrl(skin.lang_group), t("shareCopied"))}
                onContextMenu={(e) => {
                  e.preventDefault();
                  copy(appUrl(skin.lang_group), t("appLinkCopied"));
                }}
                title={t("copyAppLink")}
              >
                {t("share")}
              </button>
              <button className="btn" onClick={() => onAuthor(skin)}>
                {t("otherCreations")}
              </button>
            </div>
            <button className="link sheet-live" onClick={() => openExternal(liveUrl(skin))}>
              {t("viewOnLive")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ value, label, locale }: { value: number; label: string; locale: string }) {
  return (
    <div className="sheet-stat">
      <strong>{formatCount(value, locale)}</strong>
      <span>{label}</span>
    </div>
  );
}
