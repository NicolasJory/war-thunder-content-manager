/**
 * Dossier de profil du joueur : `Saves/<uid>/production`.
 *
 * Deux choses y vivent et l'application les lit toutes les deux — les viseurs
 * dans `UserSights`, et l'état de la partie dans `global.blk`. Le choix du
 * compte était écrit dans `wtLive.ts` pour les seuls viseurs ; il sort ici pour
 * que les deux lecteurs le partagent au lieu d'en avoir chacun leur copie.
 */

import { promises as fs } from "fs";
import { homedir } from "os";
import path from "path";

/**
 * Retrouve le dossier de profil du compte courant.
 *
 * Plusieurs comptes peuvent avoir été utilisés sur la même machine, chacun avec
 * son dossier numéroté. Le jeu écrit `Saves/lastlogin.blk` contenant
 * `uid:i64=<identifiant>`, qui désigne le dernier compte connecté : on s'en
 * sert, et on ne retombe sur un choix arbitraire que s'il manque.
 *
 * Rend `null` quand le jeu n'a jamais été lancé sur cette machine.
 */
export async function resolveProfileDir(): Promise<string | null> {
  const saves = path.join(homedir(), "Documents", "My Games", "WarThunder", "Saves");

  let accounts: string[];
  try {
    accounts = (await fs.readdir(saves, { withFileTypes: true }))
      .filter((e) => e.isDirectory() && /^\d+$/.test(e.name))
      .map((e) => e.name);
  } catch {
    return null;
  }
  if (accounts.length === 0) return null;

  let chosen = accounts[0];
  if (accounts.length > 1) {
    try {
      const blk = await fs.readFile(path.join(saves, "lastlogin.blk"), "utf8");
      const uid = blk.match(/uid\s*:\s*i64\s*=\s*(\d+)/)?.[1];
      if (uid && accounts.includes(uid)) chosen = uid;
    } catch {
      // Pas de lastlogin lisible : on garde le premier compte trouvé plutôt
      // que d'échouer. Le joueur verra le chemin exact dans l'application.
    }
  }
  return path.join(saves, chosen, "production");
}
