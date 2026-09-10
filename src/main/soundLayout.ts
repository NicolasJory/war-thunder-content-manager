/**
 * Analyse d'une archive de mods son, et patch du bloc `sound` de config.blk.
 *
 * Le jeu lit les banques FMOD à plat dans `<jeu>/sound/mod/`, et seulement si
 * `config.blk` porte `enable_mod:b=yes`. Il n'y a qu'une place par nom de
 * fichier : deux banques `crew_dialogs_ground.bank` ne coexistent pas.
 *
 * C'est ce qui rend certaines archives ambiguës. Sur 20 archives relevées :
 *
 *   10  banques à la racine du zip                     rien à demander
 *    5  un seul dossier racine, banques dedans          rien à demander
 *    1  dossiers aux fichiers distincts (Girls und Panzer : Tanks, Ships,
 *       Planes, Radio Chat, Background music)           ils s'additionnent
 *    3  dossiers aux MÊMES fichiers (Ooarai : 9 équipages portant chacun les
 *       9 mêmes .bank ; IASM : 22 dossiers RWR)         il faut en choisir un
 *    1  variantes préfixées à la racine (Yuka : English_/Chinese_/Japanese_
 *       aircraft_gui.bank)                              choisir ET renommer
 *
 * Le repère n'est pas le nom du dossier, c'est le nom des fichiers : deux
 * dossiers qui posent une même banque sont des alternatives, deux dossiers qui
 * n'en partagent aucune s'additionnent. Rien à deviner, ça se calcule.
 *
 * Attention au faux ami : `_crew_dialogs_ground_en.bank` et
 * `_crew_dialogs_ground_ru.bank` ne s'excluent PAS. Ce sont deux fichiers
 * différents, que le jeu choisit selon la nationalité de l'équipage. Un mod
 * les livre tous, on les pose tous.
 *
 * Ce module est pur : il reçoit des noms d'entrées et du texte, il rend un
 * plan et du texte. Il se teste sans réseau ni système de fichiers.
 */

export interface SoundGroup {
  /** Dossier dans l'archive, préfixe commun retiré. "" = à la racine. */
  dir: string;
  /** Entrées du zip de ce groupe, chemin complet. */
  entries: string[];
  /** Noms de banques posées, sans dossier — c'est là-dessus qu'on compare. */
  files: string[];
  /** Dossiers d'autres groupes qui posent au moins une même banque. */
  clashesWith: string[];
}

export interface SoundPlan {
  /** Préfixe commun à toutes les banques, retiré des `dir`. "" ou finit par "/". */
  strip: string;
  groups: SoundGroup[];
  /** Au moins deux groupes se disputent une banque : l'utilisateur doit trancher. */
  needsChoice: boolean;
  /**
   * Entrées à poser sous un AUTRE nom que le leur, parce que l'auteur a préfixé
   * ses variantes. Voir `splitVariants`.
   */
  renames: Record<string, string>;
}

const dirOf = (p: string) => {
  const i = p.lastIndexOf("/");
  return i === -1 ? "" : p.slice(0, i);
};

const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/**
 * Un zip fabriqué sous macOS embarque `__MACOSX/._nom.bank`, qui n'est pas une
 * banque mais une fourche de ressources. La compter fausserait le classement :
 * elle donnerait un groupe fantôme en conflit avec le vrai.
 */
const isJunk = (p: string) => /(^|\/)__MACOSX\//.test(p) || /(^|\/)\._/.test(p);

/** Segments de tête communs à tous les dossiers, pour retirer l'emballage. */
function commonDir(dirs: string[]): string {
  // Une banque posée à la racine interdit tout emballage commun.
  if (dirs.length === 0 || dirs.some((d) => d === "")) return "";
  let common = dirs[0].split("/");
  for (const d of dirs.slice(1)) {
    const parts = d.split("/");
    let i = 0;
    while (i < common.length && i < parts.length && common[i] === parts[i]) i++;
    common = common.slice(0, i);
    if (common.length === 0) break;
  }
  return common.length ? common.join("/") + "/" : "";
}

/**
 * Variantes distinguées par un PRÉFIXE au lieu d'un dossier.
 *
 * `Yuka_vws_2.0` livre `English_aircraft_gui.bank`, `Chinese_aircraft_gui.bank`
 * et `Japanese_aircraft_gui.bank` côte à côte, à la racine. Le jeu ne lit que
 * `aircraft_gui.bank` : posés tels quels, les trois ne font strictement rien.
 * L'auteur attend qu'on en renomme un.
 *
 * Le repère est le catalogue de banques du jeu : un nom qui vaut `<préfixe>_` +
 * une banque d'origine désigne une variante de celle-ci. On exige DEUX préfixes
 * distincts visant la même banque avant de conclure — un fichier préfixé isolé
 * est plus probablement une banque que le mod ajoute pour son compte.
 *
 * Ne pas confondre avec `_crew_dialogs_ground_ja.bank`, absent d'une install
 * qui n'a pas le japonais : celui-là suit le nommage d'origine, le jeu le lira
 * si la langue est choisie. Il ne se termine par `_` + aucune banque connue.
 */
function splitVariants(
  entries: string[],
  stock: Map<string, string>
): { rest: string[]; families: Map<string, string[]>; targets: Map<string, string> } | null {
  const targets = new Map<string, string>();
  const prefixes = new Map<string, string>();

  for (const entry of entries) {
    const base = baseOf(entry).toLowerCase();
    if (stock.has(base)) continue;
    let best = "";
    for (const known of stock.keys()) {
      if (base.length > known.length + 1 && base.endsWith("_" + known) && known.length > best.length) {
        best = known;
      }
    }
    if (!best) continue;
    targets.set(entry, stock.get(best)!);
    // Le préfixe se découpe sur le nom D'ORIGINE : « English » se lit mieux
    // que « english » à l'écran, et la casse ne change pas la longueur.
    prefixes.set(entry, baseOf(entry).slice(0, base.length - best.length - 1));
  }

  const distinct = new Set(prefixes.values());
  if (distinct.size < 2) return null;

  const families = new Map<string, string[]>();
  const rest: string[] = [];
  for (const entry of entries) {
    const prefix = prefixes.get(entry);
    if (!prefix) {
      rest.push(entry);
      continue;
    }
    const list = families.get(prefix);
    if (list) list.push(entry);
    else families.set(prefix, [entry]);
  }
  return { rest, families, targets };
}

/**
 * Classe les dossiers d'une archive, ou rend `null` si elle ne contient aucune
 * banque. Refuser vaut mieux que poser au hasard : des fichiers copiés dans
 * `sound/mod/` que le jeu ne lit pas resteraient invisibles et indéboulonnables.
 *
 * @param entries     noms d'entrées du zip, séparateur `/`
 * @param stockBanks  banques livrées par le jeu, lues dans `<jeu>/sound`. Sans
 *                    elles, les variantes préfixées passent inaperçues : le
 *                    classement reste correct, simplement moins fin.
 */
export function planSoundLayout(
  entries: string[],
  stockBanks: Iterable<string> = []
): SoundPlan | null {
  const banks = entries.filter((e) => !e.endsWith("/") && /\.bank$/i.test(e) && !isJunk(e));
  if (banks.length === 0) return null;

  const stock = new Map<string, string>();
  for (const name of stockBanks) stock.set(name.toLowerCase(), name);

  const strip = commonDir(banks.map(dirOf));

  const byDir = new Map<string, string[]>();
  for (const entry of banks) {
    const dir = dirOf(entry).slice(strip.length);
    const list = byDir.get(dir);
    if (list) list.push(entry);
    else byDir.set(dir, [entry]);
  }

  const renames: Record<string, string> = {};
  const groups: SoundGroup[] = [];

  for (const [dir, list] of byDir) {
    const split = stock.size > 0 ? splitVariants(list, stock) : null;
    if (!split) {
      groups.push({ dir, entries: list, files: list.map(baseOf), clashesWith: [] });
      continue;
    }

    if (split.rest.length > 0) {
      groups.push({ dir, entries: split.rest, files: split.rest.map(baseOf), clashesWith: [] });
    }
    for (const [prefix, ents] of split.families) {
      for (const e of ents) renames[e] = split.targets.get(e)!;
      // `files` porte les noms d'ARRIVÉE : c'est ce qui fait tomber les variantes
      // sous la même détection de conflit que les dossiers, sans cas particulier.
      groups.push({
        dir: dir ? `${dir}/${prefix}` : prefix,
        entries: ents,
        files: ents.map((e) => renames[e]),
        clashesWith: [],
      });
    }
  }

  // Comparaison insensible à la casse : Windows ne distingue pas
  // `Masterbank.bank` de `masterbank.bank`, le second écraserait le premier
  // sans qu'on l'ait vu venir.
  const lower = groups.map((g) => new Set(g.files.map((f) => f.toLowerCase())));
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (![...lower[i]].some((f) => lower[j].has(f))) continue;
      groups[i].clashesWith.push(groups[j].dir);
      groups[j].clashesWith.push(groups[i].dir);
    }
  }

  groups.sort((a, b) => a.dir.localeCompare(b.dir));
  return {
    strip,
    groups,
    needsChoice: groups.some((g) => g.clashesWith.length > 0),
    renames,
  };
}

/** Nom sous lequel une entrée doit être posée dans `sound/mod`. */
export function targetName(plan: SoundPlan, entry: string): string {
  return plan.renames[entry] ?? baseOf(entry);
}

/**
 * Entrées à extraire pour une sélection de dossiers. Une sélection absente
 * prend tout : c'est le bon comportement pour les 16 archives sur 20 qui n'ont
 * qu'un groupe ou des groupes qui s'additionnent.
 */
export function soundEntriesFor(plan: SoundPlan, chosen?: string[]): string[] {
  const keep = chosen ? new Set(chosen) : null;
  return plan.groups.filter((g) => !keep || keep.has(g.dir)).flatMap((g) => g.entries);
}

/**
 * Ce qui est coché en arrivant sur l'écran de choix : tout ce qui s'additionne,
 * plus le premier de chaque famille d'alternatives.
 *
 * Sur `IASM v17.5` ça donne « Step 1 » et un seul dossier RWR, ce que son
 * auteur demande dans le nom même de ses dossiers.
 */
export function defaultSelection(plan: SoundPlan): string[] {
  const chosen: string[] = [];
  const excluded = new Set<string>();
  for (const g of plan.groups) {
    if (excluded.has(g.dir)) continue;
    chosen.push(g.dir);
    for (const d of g.clashesWith) excluded.add(d);
  }
  return chosen;
}

/**
 * Une sélection est-elle tenable ? Deux dossiers qui se disputent une banque ne
 * peuvent pas être retenus ensemble, et il faut au moins un dossier.
 */
export function isValidSelection(plan: SoundPlan, chosen: string[]): boolean {
  if (chosen.length === 0) return false;
  const set = new Set(chosen);
  return plan.groups
    .filter((g) => set.has(g.dir))
    .every((g) => !g.clashesWith.some((d) => set.has(d)));
}

// ------------------------- config.blk ------------------------- //

/** Le bloc `sound{ … }` de config.blk, repéré en comptant les accolades. */
function findSoundBlock(text: string): { open: number; close: number } | null {
  const head = /(^|\r?\n)[ \t]*sound[ \t]*\{/.exec(text);
  if (!head) return null;
  const open = head.index + head[0].length - 1; // position du `{`

  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return { open, close: i };
  }
  return null; // accolade jamais refermée : fichier abîmé, on n'y touche pas
}

const ENABLE_MOD = /^[ \t]*enable_mod[ \t]*:[ \t]*b[ \t]*=.*$/im;

export interface BlkPatch {
  text: string;
  /** Faux quand le fichier disait déjà ce qu'on voulait : rien n'a bougé. */
  changed: boolean;
}

/**
 * Ajoute ou retire `enable_mod:b=yes` dans le bloc `sound`.
 *
 * Pas de fichier `.bak`. Une sauvegarde posée à l'installation et restaurée des
 * semaines plus tard écraserait tout ce que le joueur a réglé entre-temps. On
 * touche à une ligne, on dit si on l'a touchée, et on la retire à la fin.
 *
 * `changed` vaut faux si `enable_mod` était déjà là à l'activation : dans ce
 * cas la ligne n'est pas à nous et on ne la retirera pas à la désactivation.
 */
export function patchSoundBlock(text: string, enable: boolean): BlkPatch {
  const block = findSoundBlock(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";

  if (!block) {
    // Jeu jamais lancé, ou config.blk sans bloc sound : on l'écrit.
    if (!enable) return { text, changed: false };
    const sep = text === "" || text.endsWith(eol) ? "" : eol;
    return { text: `${text}${sep}sound{${eol}  enable_mod:b=yes${eol}}${eol}`, changed: true };
  }

  const inner = text.slice(block.open + 1, block.close);
  const found = ENABLE_MOD.exec(inner);

  if (enable) {
    if (found) return { text, changed: false };
    // L'indentation est reprise sur la première ligne du bloc : deux espaces
    // dans un config.blk de Gaijin, mais rien ne l'impose.
    const indent = /\n([ \t]+)\S/.exec(inner)?.[1] ?? "  ";
    const insert = `${eol}${indent}enable_mod:b=yes`;
    return { text: text.slice(0, block.open + 1) + insert + text.slice(block.open + 1), changed: true };
  }

  if (!found) return { text, changed: false };
  // La ligne part avec son saut de ligne, sinon le bloc gagne une ligne vide
  // à chaque aller-retour.
  const start = block.open + 1 + found.index;
  let end = start + found[0].length;
  if (text.startsWith("\r\n", end)) end += 2;
  else if (text.startsWith("\n", end)) end += 1;
  else {
    let back = start;
    if (text.endsWith("\n", back)) back -= text.endsWith("\r\n", back) ? 2 : 1;
    return { text: text.slice(0, back) + text.slice(end), changed: true };
  }
  return { text: text.slice(0, start) + text.slice(end), changed: true };
}
