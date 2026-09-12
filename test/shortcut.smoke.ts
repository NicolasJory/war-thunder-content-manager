/**
 * Traduction d'une frappe en raccourci Electron. `npm run smoke:shortcut`.
 *
 * Deux pièges que ce check garde :
 *
 *  1. Le CLAVIER. Sur un AZERTY, `Alt+A` rend `key === "q"` : se fier à `key`
 *     enregistrerait un raccourci qui ne correspond pas à la touche pressée.
 *     On lit `code`, qui nomme la touche physique — ce qu'attend Electron.
 *  2. Les TOUCHES SEULES. `globalShortcut` accepte « A » tout court, et la
 *     frappe serait alors volée au jeu à chaque fois qu'on écrit. On exige un
 *     modificateur, sauf pour les touches de fonction qui ne servent à rien
 *     d'autre.
 */

import assert from "assert";
import { comboFromEvent } from "../src/renderer/src/ShortcutField.js";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

type Frappe = {
  key: string;
  code: string;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
};

const lire = (f: Frappe) =>
  comboFromEvent({
    key: f.key,
    code: f.code,
    ctrlKey: !!f.ctrlKey,
    altKey: !!f.altKey,
    shiftKey: !!f.shiftKey,
    metaKey: !!f.metaKey,
  });

/** La combinaison retenue, ou null si la frappe n'a pas abouti. */
const combo = (f: Frappe) => {
  const r = lire(f);
  return "combo" in r ? r.combo : null;
};

/** Pourquoi la frappe a été écartée : "attente" ou le motif du refus. */
const motif = (f: Frappe) => {
  const r = lire(f);
  if ("combo" in r) return "accepte";
  return "attente" in r ? "attente" : r.refus;
};

// Le cas nominal, celui du défaut.
assert.equal(combo({ key: "x", code: "KeyX", altKey: true }), "Alt+X");
ok("Alt+X");

// AZERTY : la touche physique A rend `key` = "q" sous Alt. C'est `code` qui
// décide, sinon on enregistrerait Alt+Q pour une frappe sur A.
assert.equal(combo({ key: "q", code: "KeyA", altKey: true }), "Alt+A");
ok("clavier AZERTY : la touche physique l'emporte sur le caractère produit");

// Les modificateurs se cumulent, dans l'ordre attendu par Electron.
assert.equal(
  combo({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }),
  "Control+Shift+K"
);
assert.equal(combo({ key: "p", code: "KeyP", metaKey: true }), "Super+P");
ok("modificateurs cumulés, dans l'ordre d'Electron");

// Chiffres, pavé numérique, flèches, espace.
assert.equal(combo({ key: "1", code: "Digit1", ctrlKey: true }), "Control+1");
assert.equal(combo({ key: "5", code: "Numpad5", altKey: true }), "Alt+num5");
assert.equal(combo({ key: "ArrowUp", code: "ArrowUp", altKey: true }), "Alt+Up");
assert.equal(combo({ key: " ", code: "Space", ctrlKey: true }), "Control+Space");
ok("chiffres, pavé numérique, flèches et espace");

// Une touche de fonction se suffit à elle-même.
assert.equal(combo({ key: "F9", code: "F9" }), "F9");
assert.equal(combo({ key: "F9", code: "F9", shiftKey: true }), "Shift+F9");
ok("les touches de fonction valent seules");

// Une lettre seule volerait la frappe au jeu : refusée, et on dit pourquoi.
assert.equal(motif({ key: "a", code: "KeyA" }), "modificateur");
assert.equal(motif({ key: "1", code: "Digit1" }), "modificateur");
ok("touche seule sans modificateur : refusée avec son motif");

// Un modificateur enfoncé seul veut dire « je n'ai pas fini », pas « refusé » :
// afficher une erreur pendant qu'on compose serait insupportable.
for (const k of ["Control", "Alt", "Shift", "Meta", "AltGraph"]) {
  assert.equal(motif({ key: k, code: `${k}Left`, altKey: true }), "attente", k);
}
ok("modificateur seul : attente, pas refus — on compose encore");

// Les touches qui pilotent le champ lui-même.
assert.equal(motif({ key: "Escape", code: "Escape", altKey: true }), "reservee");
assert.equal(motif({ key: "Tab", code: "Tab", ctrlKey: true }), "reservee");
assert.equal(motif({ key: "Backspace", code: "Backspace", altKey: true }), "reservee");
ok("Échap, Tab et Retour arrière : refusées comme réservées");

// Le point qui a valu ce correctif : une frappe écartée doit TOUJOURS porter
// un motif. Rester muet se lit comme une panne — c'est ce qui s'est passé.
for (const f of [
  { key: "a", code: "KeyA" },
  { key: "Tab", code: "Tab", ctrlKey: true },
  { key: "Escape", code: "Escape" },
] as Frappe[]) {
  assert.notEqual(motif(f), "accepte");
  assert.notEqual(motif(f), "attente", "une frappe finie ne doit pas rester muette");
}
ok("toute frappe écartée porte un motif affichable");

console.log(`\n${passed} checks OK — saisie d'un raccourci\n`);
