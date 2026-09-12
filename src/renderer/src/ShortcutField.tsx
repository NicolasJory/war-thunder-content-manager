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
import type { Key } from "./i18n";

/** Touches qui ne valent rien seules : un raccourci global en a besoin d'une autre. */
const MODIFICATEURS = new Set(["Control", "Alt", "Shift", "Meta", "AltGraph"]);

/**
 * Ce qu'une frappe produit.
 *
 * Trois issues, et les distinguer compte : un modificateur enfoncé seul veut
 * dire « je n'ai pas fini », un refus veut dire « recommence autrement ». Les
 * confondre laissait le champ muet, et ne rien afficher se lit comme une panne.
 */
export type Frappe =
  | { combo: string }
  /** Modificateur seul : la combinaison n'est pas terminée, on attend. */
  | { attente: true }
  | { refus: "modificateur" | "reservee" };

/**
 * Traduit un événement clavier en combinaison Electron.
 *
 * Rend `attente` tant que seule une touche morte est enfoncée — appuyer sur Alt
 * ne doit pas valider « Alt » comme raccourci.
 */
export function comboFromEvent(e: {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}): Frappe {
  if (MODIFICATEURS.has(e.key)) return { attente: true };

  // Ces touches pilotent le champ lui-même : les capturer empêcherait d'annuler
  // ou de naviguer au clavier.
  if (e.code === "Escape" || e.code === "Tab" || e.code === "Backspace") {
    return { refus: "reservee" };
  }

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Control");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  if (e.metaKey) parts.push("Super");

  // `code` plutôt que `key` : sur un clavier AZERTY, Alt+A rend `key` = "q".
  // Electron attend le nom physique de la touche.
  let touche = e.code;
  const fonction = /^F\d{1,2}$/.test(touche);
  if (touche.startsWith("Key")) touche = touche.slice(3);
  else if (touche.startsWith("Digit")) touche = touche.slice(5);
  else if (touche.startsWith("Numpad")) touche = `num${touche.slice(6).toLowerCase()}`;
  else if (touche.startsWith("Arrow")) touche = touche.slice(5);

  if (!touche) return { refus: "reservee" };

  // Une touche seule est acceptée par Electron mais volerait la frappe au jeu.
  // Les touches de fonction ne servent à rien d'autre : elles passent seules.
  if (parts.length === 0 && !fonction) return { refus: "modificateur" };

  parts.push(touche);
  return { combo: parts.join("+") };
}

export function ShortcutField({ value, onSaved }: { value: string; onSaved: (v: string) => void }) {
  const { t } = useShell();
  const [enregistre, setEnregistre] = useState(false);
  /** Pourquoi la dernière frappe n'a pas été retenue. "" = rien à signaler. */
  const [refus, setRefus] = useState("");
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
      const frappe = comboFromEvent(e);
      // Modificateur seul : l'utilisateur compose encore, on ne dit rien.
      if ("attente" in frappe) return;
      if ("refus" in frappe) {
        setRefus(frappe.refus === "reservee" ? "shortcutReserved" : "shortcutNeedsModifier");
        return;
      }

      setEnregistre(false);
      const accepte = await api.overlay.setShortcut(frappe.combo);
      setRefus(accepte ? "" : "shortcutRefused");
      if (accepte) onSaved(frappe.combo);
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
          setRefus("");
          setEnregistre((v) => !v);
        }}
      >
        {enregistre ? t("shortcutPress") : value || t("shortcutNone")}
      </button>
      <p className="hint">{t("shortcutHelp")}</p>
      {refus && <p className="error">{t(refus as Key)}</p>}
    </div>
  );
}
