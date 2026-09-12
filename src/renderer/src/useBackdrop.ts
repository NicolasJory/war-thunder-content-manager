/**
 * Fermeture d'une modale au clic sur le fond, sans fermer par accident.
 *
 * Le piège : quand on sélectionne du texte dans la boîte en maintenant le
 * bouton, puis qu'on relâche en dehors, le navigateur émet quand même un
 * `click` — sur l'ancêtre commun du départ et de l'arrivée, c'est-à-dire le
 * fond. Un simple `onClick={onClose}` refermait donc la boîte alors que
 * l'utilisateur voulait juste sélectionner son texte, et lui faisait perdre
 * ce qu'il avait saisi.
 *
 * On retient donc où le geste a COMMENCÉ : fermer n'a de sens que si l'appui
 * ET le relâchement sont sur le fond.
 */

import { useCallback, useRef } from "react";
import type { MouseEvent } from "react";

/**
 * La décision, sans React ni DOM : deux booléens entrent, une fermeture sort.
 *
 * Séparée du hook pour être vérifiable — un hook ne s'appelle pas hors d'un
 * composant, et un test qui recopierait sa logique ne prouverait rien sur elle.
 */
export function backdropGuard(onClose: () => void) {
  let depuisLeFond = false;
  return {
    press(surLeFond: boolean): void {
      depuisLeFond = surLeFond;
    },
    release(surLeFond: boolean): void {
      const ferme = depuisLeFond && surLeFond;
      // Rearmé dans tous les cas : un geste ignoré ne doit pas fermer au clic
      // suivant, qui n'aura peut-être pas d'appui à lui.
      depuisLeFond = false;
      if (ferme) onClose();
    },
  };
}

export function useBackdrop(onClose: () => void) {
  const garde = useRef<ReturnType<typeof backdropGuard> | null>(null);
  const ferme = useRef(onClose);
  ferme.current = onClose;
  if (!garde.current) garde.current = backdropGuard(() => ferme.current());

  const surLeFond = (e: MouseEvent) => e.target === e.currentTarget;

  return {
    onMouseDown: useCallback((e: MouseEvent) => garde.current!.press(surLeFond(e)), []),
    onClick: useCallback((e: MouseEvent) => garde.current!.release(surLeFond(e)), []),
  };
}
