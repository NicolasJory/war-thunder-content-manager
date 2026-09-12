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

const combo = (f: Frappe) =>
  comboFromEvent({
    key: f.key,
    code: f.code,
    ctrlKey: !!f.ctrlKey,
    altKey: !!f.altKey,
    shiftKey: !!f.shiftKey,
    metaKey: !!f.metaKey,
  });

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

// Une lettre seule volerait la frappe au jeu : refusée.
assert.equal(combo({ key: "a", code: "KeyA" }), null);
assert.equal(combo({ key: "1", code: "Digit1" }), null);
ok("touche seule sans modificateur : refusée");

// Un modificateur enfoncé seul n'est pas un raccourci.
for (const k of ["Control", "Alt", "Shift", "Meta", "AltGraph"]) {
  assert.equal(combo({ key: k, code: `${k}Left`, altKey: true }), null, k);
}
ok("un modificateur seul ne valide rien");

// Les touches qui servent à annuler ou naviguer restent au formulaire.
assert.equal(combo({ key: "Escape", code: "Escape", altKey: true }), null);
assert.equal(combo({ key: "Tab", code: "Tab", ctrlKey: true }), null);
assert.equal(combo({ key: "Backspace", code: "Backspace", altKey: true }), null);
ok("Échap, Tab et Retour arrière ne s'enregistrent pas");

console.log(`\n${passed} checks OK — saisie d'un raccourci\n`);
