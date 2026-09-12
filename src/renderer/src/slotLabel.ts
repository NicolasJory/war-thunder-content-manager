/**
 * Libellés lisibles des emplacements sonores.
 *
 * Les noms du jeu sont composés, pas arbitraires : `tanks_engines`,
 * `aircraft_engines`, `ships_engines` partagent leur seconde moitié, et
 * `_crew_dialogs_ground_fr` n'est que `crew_dialogs_ground` plus une langue.
 * On traduit donc les morceaux, jamais les combinaisons.
 *
 * Le compte : sur les 20 archives les plus téléchargées, il y a 4 familles de
 * dialogues, 31 langues et une vingtaine d'emplacements fixes. Écrites en
 * entier dans quatre langues d'interface, ça ferait plus de 400 chaînes. En
 * morceaux, il en reste une trentaine — et les noms de langue ne sont pas
 * écrits du tout.
 *
 * Un nom inconnu n'est jamais masqué : il ressort nettoyé plutôt que traduit à
 * tort. Le jeu ajoute des banques à chaque mise à jour, et afficher
 * `tanks_new_thing` vaut mieux que de prétendre savoir ce que c'est.
 */

import { parseSlot } from "../../main/soundSlots.js";
import type { Key, T } from "./i18n";

/** Véhicule concerné, quand le nom en porte un. */
const VEHICLES = ["tanks", "aircraft", "ships", "infantry"] as const;

/**
 * Codes de langue du jeu qui ne sont pas des codes BCP-47.
 *
 * Le reste passe tel quel : `fr`, `de`, `ru`, `en_us` → `en-US`. Ceux-là sont
 * les exceptions relevées dans les archives réelles.
 */
const LANG_FIX: Record<string, string> = {
  jp: "ja", // le jeu écrit jp, la norme dit ja
  sp: "es",
  cz: "cs",
  nw: "no",
};

/**
 * Nom d'une langue dans la langue de l'interface.
 *
 * `Intl.DisplayNames` fait le travail et connaît les 31 codes rencontrés, y
 * compris les régionaux — `en_us` donne « anglais américain » en français et
 * « American English » en anglais. Écrire ces noms à la main aurait été 124
 * chaînes à maintenir pour un résultat moins bon.
 */
export function languageName(code: string, locale: string): string {
  const tag = (LANG_FIX[code] ?? code).replace("_", "-");
  try {
    const shown = new Intl.DisplayNames([locale], { type: "language" }).of(tag);
    // Rendu inchangé : le code est inconnu de la norme. Le dire brut est plus
    // honnête que d'afficher un identifiant déguisé en nom.
    if (shown && shown.toLowerCase() !== tag.toLowerCase()) return shown;
  } catch {
    /* locale ou code refusé par la plateforme */
  }
  return code.toUpperCase();
}

/** Remplace les rares clés absentes par le nom brut, lisible plutôt que vide. */
function tryKey(t: T, key: string, raw: string): string {
  const shown = t(key as Key);
  return shown === key ? raw.replace(/_/g, " ") : shown;
}

/**
 * Ce qu'on affiche pour un emplacement : un titre, et le véhicule auquel il se
 * rapporte quand le nom en désigne un. Les deux servent à regrouper les lignes.
 */
export interface SlotLabel {
  title: string;
  /** « Chars », « Avions »… ou "" pour ce qui vaut pour tout le jeu. */
  group: string;
}

export function slotLabel(slot: string, t: T, locale: string): SlotLabel {
  const parsed = parseSlot(slot);

  if (parsed.family && parsed.lang) {
    return {
      title: languageName(parsed.lang, locale),
      group: tryKey(t, `slotFamily_${parsed.family}`, parsed.family),
    };
  }

  const fixed = parsed.fixed ?? slot;
  const vehicle = VEHICLES.find((v) => fixed.startsWith(`${v}_`));
  if (vehicle) {
    const aspect = fixed.slice(vehicle.length + 1);
    return {
      title: tryKey(t, `slotAspect_${aspect}`, aspect),
      group: tryKey(t, `slotVehicle_${vehicle}`, vehicle),
    };
  }

  return { title: tryKey(t, `slot_${fixed}`, fixed), group: "" };
}
