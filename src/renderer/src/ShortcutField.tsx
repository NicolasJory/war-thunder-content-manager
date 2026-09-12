/**
 * Réglage du raccourci qui montre le panneau flottant.
 *
 * La combinaison se saisit en l'appuyant, pas en la tapant : personne ne connaît
 * par cœur la syntaxe d'Electron (`Alt+X`, `CommandOrControl+Shift+K`), et une
 * chaîne mal formée serait refusée sans qu'on sache pourquoi.
 *
 * Le système peut refuser une combinaison déjà prise par une autre application.
 * Le main remet alors l'ancienne et rend `false` : on le dit plutôt que de
 * laisser croire que c'est enregistré.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useShell } from "./shell";

/** Touches qui ne valent rien seules : un raccourci global en a besoin d'une autre. */
const MODIFICATEURS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);

/**
 * Traduit un événement clavier en combinaison Electron.
 *
 * Rend `null` tant que seule une touche morte est enfoncée — appuyer sur Alt
 * ne doit pas valider « Alt » comme raccourci.
 */
export function comboFromEvent(e: {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): string | null {
  if (MODIFICATEURS.has(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");

  // `code` plutôt que `key` : sur un clavier AZERTY, Alt+A rend `key` = "q".
  // Electron attend le nom physique de la touche.
  let touche = e.code;
  if (touche.startsWith("Key")) touche = touche.slice(3);
  else if (touche.startsWith("Digit")) touche = touche.slice(5);
  else if (touche.startsWith("Numpad")) touche = `num${touche.slice(6).toLowerCase()}`;
  else if (touche.startsWith("Arrow")) touche = touche.slice(5);
  else if (/^F\d{1,2}$/.test(touche)) {
    /* F1..F24 passent tels quels */
  } else if (touche === "Space") touche = "Space";
  else if (touche === "Escape" || touche === "Tab" || touche === "Backspace") return null;
  else touche = touche.replace(/^(Key|Digit)/, "");

  if (!touche) return null;
  // Une touche seule est acceptée par Electron mais volerait la frappe au jeu.
  if (parts.length === 0 && !/^F\d{1,2}$/.test(touche)) return null;

  parts.push(touche);
  return parts.join("+");
}

export function ShortcutField({ value, onSaved }: { value: string; onSaved: (v: string) => void }) {
  const { t } = useShell();
  const [enregistre, setEnregistre] = useState(false);
  const [refuse, setRefuse] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);

  const arreter = useCallback(() => setEnregistre(false), []);

  useEffect(() => {
    if (!enregistre) return;

    const onKey = async (e: KeyboardEvent) => {
      e.preventDefault();
      if (e.key === "Escape") {
        arreter();
        return;
      }
      const combo = comboFromEvent(e);
      if (!combo) return;

      setEnregistre(false);
      const accepte = await api.overlay.setShortcut(combo);
      setRefuse(!accepte);
      if (accepte) onSaved(combo);
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enregistre, arreter, onSaved]);

  return (
    <div className="shortcut-field">
      <span className="field-label">{t("shortcutLabel")}</span>
      <button
        ref={btn}
        className={enregistre ? "btn primary shortcut-btn" : "btn shortcut-btn"}
        onClick={() => {
          setRefuse(false);
          setEnregistre((v) => !v);
        }}
      >
        {enregistre ? t("shortcutPress") : value || t("shortcutNone")}
      </button>
      <p className="hint">{t("shortcutHelp")}</p>
      {refuse && <p className="error">{t("shortcutRefused")}</p>}
    </div>
  );
}
