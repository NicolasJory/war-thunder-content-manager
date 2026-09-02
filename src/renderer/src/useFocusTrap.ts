/**
 * Maintient le focus clavier à l'intérieur d'une boîte modale.
 *
 * Échap fermait déjà, mais la tabulation sortait vers la grille derrière : on
 * se retrouvait à piloter une liste invisible sous un panneau opaque. Une
 * modale doit contenir le focus tant qu'elle est ouverte, et le rendre là où il
 * était en se fermant.
 */

import { useEffect, type RefObject } from "react";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function useFocusTrap(ref: RefObject<HTMLElement | null>, active = true) {
  useEffect(() => {
    const root = ref.current;
    if (!root || !active) return;

    const previous = document.activeElement as HTMLElement | null;

    const targets = () =>
      [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
        (el) => el.offsetParent !== null || el === document.activeElement
      );

    // Le premier élément prend le focus, sinon la boîte elle-même : sans ça, la
    // première tabulation partirait encore vers l'extérieur.
    const first = targets()[0];
    (first ?? root).focus({ preventScroll: true });

    function onKey(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      const list = targets();
      if (list.length === 0) {
        e.preventDefault();
        return;
      }
      const current = document.activeElement as HTMLElement;
      const at = list.indexOf(current);
      const next = e.shiftKey ? at - 1 : at + 1;

      // On ne boucle explicitement qu'aux extrémités ; entre les deux, le
      // comportement natif du navigateur reste le meilleur.
      if (at === -1 || next < 0 || next >= list.length) {
        e.preventDefault();
        list[(next + list.length) % list.length].focus();
      }
    }

    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      previous?.focus?.({ preventScroll: true });
    };
  }, [ref, active]);
}
