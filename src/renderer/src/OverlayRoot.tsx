/**
 * Racine du panneau flottant.
 *
 * `ShellProvider` porte la langue, les notifications et l'orchestration des
 * installations : le panneau en a besoin pour que son bouton Installer marche
 * exactement comme celui de l'application. Il garde donc sa propre copie de la
 * configuration, rechargée quand la fenêtre s'ouvre.
 */

import { useCallback, useEffect, useState } from "react";
import { api, type InstalledRecord, type WtConfigFile } from "./api";
import { Overlay } from "./Overlay";
import { ShellProvider } from "./shell";

export function OverlayRoot() {
  const [config, setConfig] = useState<WtConfigFile | null>(null);

  useEffect(() => {
    api.config.get().then(setConfig).catch(() => undefined);
  }, []);

  const setInstalled = useCallback((installed: InstalledRecord[]) => {
    setConfig((c) => (c ? { ...c, installed } : c));
  }, []);

  if (!config) return <div className="overlay" />;

  return (
    <ShellProvider
      installed={config.installed}
      onInstalledChange={setInstalled}
      content="camouflage"
      onContent={() => undefined}
    >
      <Overlay />
    </ShellProvider>
  );
}
