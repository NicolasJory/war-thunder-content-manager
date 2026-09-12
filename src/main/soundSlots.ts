/**
 * Emplacements sonores : l'unité que le joueur choisit dans le mixeur.
 *
 * Le jeu lit `sound/mod` à plat, un fichier par nom. Chaque nom est donc une
 * place unique, qu'un seul mod peut occuper à la fois. Le mixeur consiste à
 * dire, place par place, quel mod téléchargé l'occupe — au lieu de prendre ou
 * laisser un mod entier.
 *
 * Deux règles de nommage, relevées sur les 275 banques du jeu et les 20 archives
 * les plus téléchargées :
 *
 *   1. Une banque va par PAIRE. `aircraft_gui.bank` porte les événements,
 *      `aircraft_gui.assets.bank` porte l'audio. Les 137 `.assets.bank` du jeu
 *      ont toutes leur `.bank`, sans exception. Les séparer n'aurait pas de
 *      sens : un emplacement désigne la paire, et les deux fichiers se
 *      déplacent ensemble.
 *
 *      L'inverse n'est pas vrai : un mod peut ne fournir QUE le `.assets.bank`
 *      et laisser le jeu garder ses événements d'origine. OPEX 5.0.0 fait
 *      exactement ça pour ses quatre banques de dialogues. Un emplacement se
 *      remplit donc avec ce que le mod a, pas avec ce qu'on attendrait.
 *
 *   2. Les dialogues sont paramétrés par une langue en suffixe :
 *      `_crew_dialogs_ground_fr.bank`, `_de`, `_en_us`… Le jeu choisit selon la
 *      nationalité de l'équipage, ce ne sont donc PAS des alternatives entre
 *      elles. C'est ce qui rend le mixeur utile : vouloir les voix françaises
 *      d'un mod et les allemandes d'un autre est une demande légitime que le
 *      modèle « un mod entier » ne sait pas exprimer.
 *
 * Ce module est pur : des noms entrent, des noms sortent. Aucun libellé
 * lisible ici — c'est l'affaire du renderer et de l'i18n.
 */

/** Nom logique d'un emplacement : le `.bank` de la paire, en minuscules. */
export function slotOf(filename: string): string {
  const base = filename.slice(filename.lastIndexOf("/") + 1).toLowerCase();
  return base.replace(/\.assets\.bank$/, ".bank");
}

/**
 * Familles de dialogues, paramétrées par une langue.
 *
 * Le `_` de tête est porté par les variantes par langue (`_crew_dialogs_ground_fr`)
 * mais pas par la banque générique du même nom (`crew_dialogs_ground`), qui est
 * un emplacement fixe à part entière.
 */
const FAMILY = /^_(crew_dialogs_ground|crew_dialogs_common|crew_dialogs_naval|dialogs_chat|dialogs)_([a-z]{2}(?:_[a-z]{2})?)\.bank$/;

export interface SlotName {
  /** Famille de dialogues, si c'en est une. */
  family?: string;
  /** Code de langue tel que le jeu l'écrit : `fr`, `en_us`, `jp`… */
  lang?: string;
  /** Emplacement sans paramètre : `tanks_engines.bank`, `masterbank.bank`… */
  fixed?: string;
}

/**
 * Décompose un emplacement. Le renderer s'en sert pour l'afficher : une famille
 * plus une langue se traduisent séparément, ce qui évite d'écrire à la main les
 * 4 × 31 combinaisons rencontrées dans les archives réelles.
 */
export function parseSlot(slot: string): SlotName {
  const m = FAMILY.exec(slot);
  if (m) return { family: m[1], lang: m[2] };
  return { fixed: slot.replace(/\.bank$/, "") };
}

/**
 * Une banque qu'il vaut mieux ne pas panacher.
 *
 * `masterbank` déclare les événements dont dépendent les autres banques. Deux
 * auteurs le disent eux-mêmes : PCSM demande de supprimer « the 'masterbank'
 * files that probably came from » un autre mod, et IASM range ses fichiers de
 * base dans un dossier nommé « skip if mixing with RCSM ».
 *
 * Le mixeur ne l'interdit pas — le joueur peut avoir raison de vouloir
 * essayer — mais l'interface le signale, parce qu'une combinaison ratée rend le
 * jeu muet sans dire pourquoi.
 */
export function isRisky(slot: string): boolean {
  return slot === "masterbank.bank" || slot === "masterbank.strings.bank";
}
