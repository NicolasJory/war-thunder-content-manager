/**
 * Aperçu agrandi au survol d'une carte.
 *
 * Il n'apparaît qu'après un délai : sans ça, traverser la grille en déplaçant
 * la souris ferait clignoter un panneau sur chaque carte. Le délai transforme
 * un passage en intention.
 *
 * Quand le contenu a plusieurs images, elles défilent toutes seules — c'est
 * précisément l'intérêt : juger un camouflage sans ouvrir sa fiche.
 */

import { useEffect, useRef, useState } from "react";
import { hiRes, imagesOf, type Skin } from "./api";

const OPEN_DELAY = 550;
const SLIDE_MS = 1400;
const GAP = 14;

/**
 * Largeur proportionnelle à la fenêtre, bornée. Calculée au rendu et non une
 * fois pour toutes : la fenêtre est redimensionnable, une constante figée au
 * chargement aurait donné un aperçu trop large après un agrandissement.
 */
function previewWidth(): number {
  return Math.round(Math.min(620, Math.max(380, window.innerWidth * 0.34)));
}

export interface HoverTarget {
  skin: Skin;
  rect: DOMRect;
}

/**
 * Pose le panneau à côté de la carte, du côté où il y a la place, et le garde
 * dans l'écran. Une carte de la dernière colonne aurait sinon son aperçu à
 * moitié dehors.
 */
function place(rect: DOMRect, width: number, height: number) {
  const room = window.innerWidth - rect.right;
  const left =
    room >= width + GAP * 2 ? rect.right + GAP : Math.max(GAP, rect.left - width - GAP);
  const top = Math.min(
    Math.max(GAP, rect.top + rect.height / 2 - height / 2),
    window.innerHeight - height - GAP
  );
  return { left, top };
}

export function HoverPreview({ target }: { target: HoverTarget | null }) {
  const [shown, setShown] = useState<HoverTarget | null>(null);
  const [index, setIndex] = useState(0);

  // Délai d'ouverture. Sortir de la carte annule avant même l'affichage.
  useEffect(() => {
    if (!target) {
      setShown(null);
      return;
    }
    const id = setTimeout(() => {
      setIndex(0);
      setShown(target);
    }, OPEN_DELAY);
    return () => clearTimeout(id);
  }, [target]);

  const images = shown ? imagesOf(shown.skin) : [];

  // Défilement automatique, seulement s'il y a de quoi défiler. Respecte le
  // réglage système de réduction des animations en ralentissant nettement.
  useEffect(() => {
    if (images.length < 2) return;
    const slow = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const id = setInterval(() => setIndex((i) => (i + 1) % images.length), slow ? SLIDE_MS * 2.5 : SLIDE_MS);
    return () => clearInterval(id);
  }, [images.length, shown]);

  if (!shown || images.length === 0) return null;

  const width = previewWidth();
  const height = Math.round((width * 10) / 16) + 26;
  const { left, top } = place(shown.rect, width, height);
  const src = images[Math.min(index, images.length - 1)];

  return (
    <div className="hover-preview" style={{ left, top, width }} aria-hidden="true">
      <div className="hover-frame">
        <img src={hiRes(src)} alt="" />
      </div>
      {images.length > 1 && (
        <div className="hover-dashes">
          {images.map((_, i) => (
            <span key={i} className={i === index ? "hover-dash active" : "hover-dash"} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Suit la carte survolée. Le panneau lui-même gère le délai. */
export function useHoverTarget() {
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const raf = useRef(0);

  // Un défilement pendant l'attente rendrait la position fausse : on annule.
  useEffect(() => {
    if (!target) return;
    const cancel = () => setTarget(null);
    window.addEventListener("scroll", cancel, { passive: true });
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("scroll", cancel);
      window.removeEventListener("resize", cancel);
    };
  }, [target]);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  return {
    target,
    enter: (skin: Skin, el: HTMLElement) => {
      cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(() =>
        setTarget({ skin, rect: el.getBoundingClientRect() })
      );
    },
    leave: () => {
      cancelAnimationFrame(raf.current);
      setTarget(null);
    },
  };
}
