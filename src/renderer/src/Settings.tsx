/**
 * Écran des réglages.
 *
 * Il n'a d'abord porté que le mixeur audio, et le raccourci du panneau s'y
 * était glissé faute d'un meilleur endroit — un réglage global sous un titre
 * « Paramètres audio ». La page couvre maintenant les deux, chaque domaine
 * sous son propre titre.
 */

import { Mixer } from "./Mixer";
import { ShortcutField } from "./ShortcutField";
import { useShell } from "./shell";
import type { InstalledRecord } from "./api";

export function Settings({
  records,
  onRecords,
  shortcut,
  onShortcut,
}: {
  records: InstalledRecord[];
  onRecords: (records: InstalledRecord[]) => void;
  shortcut: string;
  onShortcut: (v: string) => void;
}) {
  const { t } = useShell();

  return (
    <div className="content">
      <div className="view-head">
        <div>
          <h2>{t("tabSettings")}</h2>
        </div>
      </div>

      <section className="settings-section">
        <h3>{t("settingsShortcuts")}</h3>
        <div className="settings-block">
          <ShortcutField value={shortcut} onSaved={onShortcut} />
          {/* Fermer la fenêtre ne quitte plus : ça surprend si on ne le dit pas. */}
          <p className="hint tray-hint">{t("closeToTrayHint")}</p>
        </div>
      </section>

      <section className="settings-section">
        <h3>{t("mixerTitle")}</h3>
        <Mixer records={records} onRecords={onRecords} />
      </section>
    </div>
  );
}
