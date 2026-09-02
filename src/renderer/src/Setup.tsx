/**
 * Écran de configuration du dossier de jeu.
 *
 * Affiché au premier lancement (aucun gameDir), et réouvrable ensuite depuis
 * l'en-tête. On demande la RACINE du jeu, pas le dossier des skins : les
 * viseurs vivront dans un autre arbre et partent eux aussi de la racine.
 * Pointer UserSkins reste accepté, le main remonte au parent.
 */

import { useEffect, useState } from "react";
import { api } from "./api";
import { Brand, LanguageSwitch, useShell } from "./shell";

interface Props {
  current: string;
  onDone: (gameDir: string) => void;
  onCancel?: () => void;
}

export function Setup({ current, onDone, onCancel }: Props) {
  const { t, tError } = useShell();
  // validateGameDir renvoie un code + le chemin concerne, jamais du texte.
  const reasonText = (r: { reason?: string; detail?: string }) =>
    r.reason ? tError(r.detail ? `${r.reason}: ${r.detail}` : r.reason) : t("invalidFolder");
  const [dir, setDir] = useState(current);
  const [error, setError] = useState("");
  const [detecting, setDetecting] = useState(!current);
  const [busy, setBusy] = useState(false);

  // Au premier lancement on propose l'install trouvée via Steam plutôt qu'un
  // champ vide. L'utilisateur n'a plus qu'à confirmer.
  useEffect(() => {
    if (current) return;
    let alive = true;
    api.config
      .detect()
      .then((found) => {
        if (alive && found) setDir(found);
      })
      .finally(() => alive && setDetecting(false));
    return () => {
      alive = false;
    };
  }, [current]);

  async function browse() {
    setError("");
    const res = await api.config.pick({ title: t("pickTitle"), buttonLabel: t("pickButton") });
    if (res.canceled) return;
    if (!res.ok) {
      setError(reasonText(res));
      return;
    }
    setDir(res.gameDir!);
  }

  async function confirm() {
    setBusy(true);
    setError("");
    try {
      const res = await api.config.setGameDir(dir);
      if (!res.ok) setError(reasonText(res));
      else onDone(res.gameDir!);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-lang">
          <LanguageSwitch />
        </div>
        <div className="setup-brand">
          <Brand />
        </div>
        <h1>{t("setupTitle")}</h1>
        <p className="muted">
          {t("setupIntro")}

        </p>

        <label className="field-label" htmlFor="gamedir">
          {t("setupField")}
        </label>
        <div className="row">
          <input
            id="gamedir"
            className="input"
            value={detecting ? "" : dir}
            placeholder={detecting ? "" : String.raw`D:\SteamLibrary\steamapps\common\War Thunder`}
            disabled={detecting}
            onChange={(e) => {
              setDir(e.target.value);
              setError("");
            }}
            spellCheck={false}
          />
          <button className="btn" onClick={browse} disabled={busy || detecting}>
            {t("browse")}
          </button>
        </div>

        {detecting && (
          <p className="loading-inline hint">
            <span className="spinner" /> {t("detecting")}
          </p>
        )}
        {!detecting && dir && !error && (
          <p className="hint">
            {t("skinsDestination")} : <code>{dir + String.raw`\UserSkins`}</code>
          </p>
        )}
        {error && <p className="error">{error}</p>}

        <div className="setup-actions">
          {onCancel && (
            <button className="btn ghost" onClick={onCancel} disabled={busy}>
              {t("cancel")}
            </button>
          )}
          <button className="btn primary" onClick={confirm} disabled={!dir.trim() || busy}>
            {busy ? t("checking") : t("continueLabel")}
          </button>
        </div>

        <p className="footnote">
          {t("setupFootnote")}

        </p>
      </div>
    </div>
  );
}
