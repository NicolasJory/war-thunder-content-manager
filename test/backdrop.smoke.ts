/**
 * Fermeture d'une modale au clic sur le fond. `npm run smoke:backdrop`.
 *
 * Le bug réparé : sélectionner du texte dans la boîte en maintenant le bouton,
 * puis relâcher en dehors, refermait la modale et faisait perdre la saisie. Le
 * navigateur émet dans ce cas un `click` sur l'ancêtre commun du départ et de
 * l'arrivée — donc sur le fond — et un `onClick` nu ne distingue pas ce geste
 * d'un vrai clic à l'extérieur.
 *
 * On teste `backdropGuard`, la décision elle-même : le hook qui l'enveloppe ne
 * fait que traduire un événement en booléen.
 */

import assert from "assert";
import { backdropGuard } from "../src/renderer/src/useBackdrop.js";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

const SUR_LE_FOND = true;
const DANS_LA_BOITE = false;

function monter() {
  let fermetures = 0;
  return { g: backdropGuard(() => fermetures++), compte: () => fermetures };
}

// Le geste qui cassait tout.
{
  const { g, compte } = monter();
  g.press(DANS_LA_BOITE);
  g.release(SUR_LE_FOND); // le navigateur vise l'ancêtre commun
  assert.equal(compte(), 0, "sélectionner du texte ne doit pas refermer");
  ok("appui dans la boîte, relâchement dehors : la modale reste ouverte");
}

// Le vrai clic à l'extérieur doit toujours fermer.
{
  const { g, compte } = monter();
  g.press(SUR_LE_FOND);
  g.release(SUR_LE_FOND);
  assert.equal(compte(), 1);
  ok("appui et relâchement sur le fond : la modale se ferme");
}

// Un clic entièrement dans la boîte ne ferme pas.
{
  const { g, compte } = monter();
  g.press(DANS_LA_BOITE);
  g.release(DANS_LA_BOITE);
  assert.equal(compte(), 0);
  ok("clic entièrement dans la boîte : rien ne se passe");
}

// Le geste inverse : appui sur le fond, relâchement dans la boîte.
{
  const { g, compte } = monter();
  g.press(SUR_LE_FOND);
  g.release(DANS_LA_BOITE);
  assert.equal(compte(), 0, "le relâchement doit aussi être sur le fond");
  ok("appui dehors, relâchement dans la boîte : la modale reste ouverte");
}

// Le drapeau se rearme : un geste ignoré ne doit pas fermer au suivant.
{
  const { g, compte } = monter();
  g.press(DANS_LA_BOITE);
  g.release(SUR_LE_FOND); // ignoré
  g.release(SUR_LE_FOND); // un relâchement isolé, sans appui à lui
  assert.equal(compte(), 0, "un relâchement sans appui sur le fond ne ferme pas");
  ok("le drapeau se rearme : pas de fermeture différée au geste suivant");
}

// Et la séquence normale marche toujours après un geste ignoré.
{
  const { g, compte } = monter();
  g.press(DANS_LA_BOITE);
  g.release(SUR_LE_FOND);
  g.press(SUR_LE_FOND);
  g.release(SUR_LE_FOND);
  assert.equal(compte(), 1);
  ok("après une sélection de texte, le clic extérieur ferme toujours");
}

console.log(`\n${passed} checks OK — fermeture des modales\n`);
