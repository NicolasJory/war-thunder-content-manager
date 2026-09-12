/**
 * Lecture du véhicule sélectionné dans `global.blk`. `npm run smoke:vehicle`.
 *
 * Le bloc visé, relevé sur un profil réel :
 *
 *     selectedAir{
 *       current_model:t="ussr_t_44_100"
 *       france:t="fr_amx_30_1972"
 *       ...
 *     }
 *
 * Le fichier fait 280 Ko et imbrique des dizaines de blocs, d'où le comptage
 * d'accolades plutôt qu'un motif : c'est ça qui peut casser en silence, en
 * renvoyant une valeur prise dans le mauvais bloc.
 */

import assert from "assert";
import { readFileSync } from "fs";
import { parseSelection } from "../src/main/currentVehicle.js";
import { resolveProfileDir } from "../src/main/wtProfile.js";
import path from "path";

let passed = 0;
const ok = (l: string) => {
  passed++;
  console.log(`  ✓ ${l}`);
};

// ------------------------- Sur des cas construits ------------------------- //

console.log("\nLecture du bloc selectedAir");

const BLK = [
  "version:i=20871",
  "",
  "content{",
  "  profile{",
  "    countryId2:i=7",
  "  }",
  "}",
  "",
  "selectedAir{",
  '  current_model:t="ussr_t_44_100"',
  '  france:t="fr_amx_30_1972"',
  '  germany:t="germ_leopard_I"',
  '  ussr:t="ussr_su_100p"',
  "}",
  "",
  "hotkeys{",
  '  current_model:t="PIEGE"',
  "}",
  "",
].join("\r\n");

{
  const s = parseSelection(BLK);
  assert.equal(s.current, "ussr_t_44_100");
  assert.deepEqual(s.byNation, {
    france: "fr_amx_30_1972",
    germany: "germ_leopard_I",
    ussr: "ussr_su_100p",
  });
  ok("véhicule courant et dernier choix par nation");

  // Le `current_model` du bloc `hotkeys` ne doit jamais gagner.
  assert.notEqual(s.current, "PIEGE");
  ok("une clé du même nom dans un autre bloc n'est pas prise");
}

// Accolades imbriquées dans le bloc : la fermeture doit être la bonne.
{
  const nested = [
    "selectedAir{",
    "  sub{",
    '    current_model:t="PIEGE"',
    "  }",
    '  current_model:t="ussr_t_44"',
    "}",
    'apres:t="x"',
    "",
  ].join("\r\n");
  assert.equal(parseSelection(nested).current, "ussr_t_44");
  ok("accolades imbriquées : le bloc se referme au bon endroit");
}

// Fichier surpris en cours d'écriture, ou sans le bloc du tout.
{
  assert.deepEqual(parseSelection(""), { current: null, byNation: {} });
  assert.deepEqual(parseSelection("video{\r\n  x:i=1\r\n}\r\n"), { current: null, byNation: {} });
  assert.deepEqual(parseSelection('selectedAir{\r\n  current_model:t="tronq'), {
    current: null,
    byNation: {},
  });
  ok("bloc absent ou fichier tronqué : sélection vide, aucune exception");
}

// Une valeur vide ne doit pas se faire passer pour un véhicule.
{
  const s = parseSelection('selectedAir{\r\n  current_model:t=""\r\n  usa:t=""\r\n}\r\n');
  assert.equal(s.current, null);
  assert.deepEqual(s.byNation, {});
  ok("valeurs vides ignorées");
}

// Les entiers et booléens du bloc ne sont pas des véhicules.
{
  const s = parseSelection(
    'selectedAir{\r\n  someFlag:b=yes\r\n  someCount:i=3\r\n  usa:t="us_pt6"\r\n}\r\n'
  );
  assert.deepEqual(s.byNation, { usa: "us_pt6" });
  ok("seules les valeurs de type texte sont retenues");
}

// ------------------------- Sur le vrai fichier ------------------------- //

console.log("\nSur le profil réel de cette machine");

const dir = await resolveProfileDir();
if (!dir) {
  console.log("  — aucun profil War Thunder ici, vérification sautée");
} else {
  const file = path.join(dir, "global.blk");
  let texte: string;
  try {
    texte = readFileSync(file, "utf8");
  } catch {
    console.log(`  — ${file} illisible, vérification sautée`);
    texte = "";
  }
  if (texte) {
    const s = parseSelection(texte);
    assert(s.current, "un profil réel doit porter un véhicule courant");
    assert(
      /^[a-z]{2,}_[\w]+$/i.test(s.current),
      `identifiant inattendu : ${s.current}`
    );
    ok(`fichier réel de ${Math.round(texte.length / 1024)} Ko : ${s.current}`);

    assert(Object.keys(s.byNation).length > 0, "les entrées par nation doivent être lues");
    ok(`${Object.keys(s.byNation).length} nations retenues`);

    // Le point qui rend la fonctionnalité possible : ces identifiants sont
    // ceux du filtre véhicule. S'ils divergeaient, il faudrait une table.
    const tax = JSON.parse(readFileSync("src/main/filters.fallback.json", "utf8"));
    const connus = new Set<string>(
      (tax.vehicle?.variants ?? [])
        .map((v: { value?: string }) => v.value)
        .filter((v: string | undefined): v is string => Boolean(v))
    );
    const tous = [s.current, ...Object.values(s.byNation)];
    const inconnus = tous.filter((v) => !connus.has(v));
    assert.deepEqual(inconnus, [], `absents de la taxonomie : ${inconnus.join(", ")}`);
    ok(`les ${tous.length} identifiants lus existent dans la taxonomie du filtre`);
  }
}

console.log(`\n${passed} checks OK — lecture du véhicule courant\n`);
