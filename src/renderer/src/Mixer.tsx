/**
 * Mixeur audio : un emplacement sonore par ligne, un mod par emplacement.
 *
 * Le modèle « un mod entier ou rien » ne sait pas exprimer une demande
 * pourtant banale — les voix françaises d'un mod et les allemandes d'un autre.
 * Le jeu lit `sound/mod` à plat, un fichier par nom : chaque nom est donc une
 * place, et le panachage est la façon naturelle de raisonner dessus.
 *
 * La vue ne liste que les places qu'au moins un mod téléchargé sait occuper,
 * plus celles qui sont occupées. Afficher les 139 banques du jeu quand deux
 * mods n'en proposent que vingt noierait le choix dans du vide.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type InstalledRecord, type SoundSlot } from "./api";
import { IconInfo } from "./icons";
import { slotLabel } from "./slotLabel";
import { useShell } from "./shell";

export function Mixer({
  records,
  onRecords,
}: {
  records: InstalledRecord[];
  onRecords: (records: InstalledRecord[]) => void;
}) {
  const { t, locale, notify, tError } = useShell();
  const [slots, setSlots] = useState<SoundSlot[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const sounds = useMemo(() => records.filter((r) => r.contentType === "sound"), [records]);

  // Relu à chaque changement de la liste installée : poser ou retirer un mod
  // change les candidats de plusieurs lignes d'un coup.
  useEffect(() => {
    let alive = true;
    api.content
      .slots()
      .then((list) => alive && setSlots(list))
      .catch(() => alive && setSlots([]));
    return () => {
      alive = false;
    };
  }, [records]);

  const assign = useCallback(
    async (slot: string, to: number | null) => {
      setBusy(slot);
      try {
        onRecords(await api.content.setSlot(slot, to));
        const list = await api.content.slots();
        setSlots(list);
      } catch (e) {
        notify(tError((e as Error).message), "err");
      } finally {
        setBusy(null);
      }
    },
    [onRecords, notify, tError]
  );

  // Les lignes se regroupent par véhicule ou par famille de dialogues : trente
  // lignes à plat se lisent mal, six groupes de cinq se parcourent.
  const groups = useMemo(() => {
    const out = new Map<string, Array<{ slot: SoundSlot; title: string }>>();
    for (const slot of slots ?? []) {
      const { title, group } = slotLabel(slot.slot, t, locale);
      const list = out.get(group);
      if (list) list.push({ slot, title });
      else out.set(group, [{ slot, title }]);
    }
    for (const list of out.values()) list.sort((a, b) => a.title.localeCompare(b.title, locale));
    return [...out.entries()].sort((a, b) => a[0].localeCompare(b[0], locale));
  }, [slots, t, locale]);

  if (sounds.length === 0) return null;

  const occupied = (slots ?? []).filter((s) => s.owner !== null || s.foreign).length;

  return (
    <section className="mixer">
      <div className="more-head">
        <h3>{t("mixerTitle")}</h3>
        <span className="muted">
          {slots ? t("mixerOccupied", { n: occupied, total: slots.length }) : ""}
        </span>
      </div>
      <p className="muted mixer-help">{t("mixerHelp")}</p>

      {slots && slots.length === 0 && <p className="muted">{t("mixerEmpty")}</p>}

      {groups.map(([group, rows]) => (
        <div key={group || "(general)"} className="mixer-group">
          {group && <p className="mixer-group-name">{group}</p>}
          {rows.map(({ slot, title }) => (
            <div key={slot.slot} className="mixer-row">
              <span className="mixer-slot" title={slot.slot}>
                {title}
                {slot.risky && (
                  <span className="mixer-risky" title={t("mixerRisky")}>
                    <IconInfo size={12} />
                  </span>
                )}
              </span>

              <select
                className="select mixer-pick"
                disabled={busy === slot.slot}
                value={slot.owner === null ? "" : String(slot.owner)}
                onChange={(e) => assign(slot.slot, e.target.value ? Number(e.target.value) : null)}
              >
                {/* Une banque posée à la main occupe la place sans qu'on sache
                    d'où elle vient : on le dit, et la remplacer reste possible. */}
                <option value="">{slot.foreign ? t("mixerForeign") : t("mixerStock")}</option>
                {slot.candidates.map((id) => (
                  <option key={id} value={String(id)}>
                    {sounds.find((r) => r.lang_group === id)?.name ?? id}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
