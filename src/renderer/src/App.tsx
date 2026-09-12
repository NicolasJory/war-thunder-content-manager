import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { api, type ContentType, type DeepLink, type FavoriteAuthor, type InstalledRecord, type Skin, type WtConfigFile } from "./api";
import { AuthorView } from "./AuthorView";
import { Browse } from "./Browse";
import { Detail } from "./Detail";
import {
  IconAudioSettings,
  IconDownload,
  IconFolder,
  IconInfo,
  IconSearch,
  IconSight,
  IconSound,
} from "./icons";
import { parseDeepLink } from "../../shared/deepLink";
import { Favorites } from "./Favorites";
import { Installed } from "./Installed";
import { Mixer } from "./Mixer";
import { Setup } from "./Setup";
import { Brand, LanguageSwitch, ShellProvider, useShell } from "./shell";

type Author = Skin["author"];
type Tab = "browse" | "installed" | "favorites" | "audio";

export default function App() {
  const [config, setConfig] = useState<WtConfigFile | null>(null);
  const [content, setContent] = useState<ContentType>("camouflage");

  useEffect(() => {
    api.config.get().then(setConfig);
  }, []);

  const setInstalled = useCallback((installed: InstalledRecord[]) => {
    setConfig((c) => (c ? { ...c, installed } : c));
  }, []);

  if (!config) {
    return (
      <div className="boot">
        <span className="spinner lg" />
      </div>
    );
  }

  return (
    <ShellProvider
      installed={config.installed}
      onInstalledChange={setInstalled}
      content={content}
      onContent={setContent}
    >
      <Shell config={config} onConfig={setConfig} />
    </ShellProvider>
  );
}

function Shell({
  config,
  onConfig,
}: {
  config: WtConfigFile;
  onConfig: (c: WtConfigFile) => void;
}) {
  const { t, toasts, notify, content, setContent } = useShell();
  const [editingDir, setEditingDir] = useState(false);
  const [tab, setTab] = useState<Tab>("browse");
  const [author, setAuthor] = useState<Author | null>(null);
  const [openSkin, setOpenSkin] = useState<Skin | null>(null);
  const [term, setTerm] = useState("");

  /*
   * Position de défilement mémorisée par vue.
   *
   * `Browse` reste monté en permanence (masqué en CSS) : le démonter perdait
   * toutes ses pages accumulées, donc revenir d'une page auteur rechargeait
   * depuis la première et effaçait un long défilement.
   *
   * La sauvegarde se fait AU MOMENT du changement de vue, pas dans un effet :
   * les effets des enfants s'exécutent avant ceux du parent, donc le retour en
   * haut du défilement infini avait déjà remis la position à zéro quand le
   * parent essayait de la lire.
   */
  const scrolls = useRef<Record<string, number>>({});
  const viewKey = author ? `author:${author.id}` : `${content}:${tab}`;

  /*
   * Liens entrants. Trois chemins mènent ici : le protocole `wtcm://`, un
   * second lancement transmis par l'instance déjà ouverte, et le lien de
   * démarrage réclamé au montage — ce dernier serait perdu sans la file du
   * main, l'interface n'étant pas prête quand il arrive.
   */
  const openLink = useCallback(
    async (link: DeepLink) => {
      setOpenSkin(null);
      if (link.kind === "tag") {
        setAuthor(null);
        setTab("browse");
        setTerm(link.tag);
        return;
      }
      if (link.kind === "author") {
        // Un lien d'auteur ne porte que le pseudo ; l'API exige l'identifiant
        // numérique, qu'on ne peut pas deviner. On bascule donc sur une
        // recherche par hashtag du pseudo, qui reste utile.
        setAuthor(null);
        setTab("browse");
        setTerm(link.nickname);
        return;
      }
      try {
        const skin = await api.content.post(link.langGroup);
        setAuthor(null);
        setTab("browse");
        setOpenSkin(skin);
        notify(t("linkOpened"));
      } catch {
        notify(t("linkNotFound"), "err");
      }
    },
    [notify, t]
  );

  useEffect(() => {
    api.takeLink().then((link) => link && openLink(link));
    return api.onDeepLink((link) => openLink(link));
  }, [openLink]);

  const goTo = useCallback(
    (next: () => void) => {
      scrolls.current[viewKey] = window.scrollY;
      next();
    },
    [viewKey]
  );

  /*
   * La restitution passe par un effet de mise en page, après le commit du DOM.
   * Un requestAnimationFrame tirait trop tôt : la vue n'était pas encore rendue,
   * le document était donc court et le défilement demandé se faisait écrêter.
   *
   * Les effets des enfants s'exécutant en premier, le retour en haut du
   * défilement infini a déjà eu lieu ici — on le remplace volontairement.
   */
  useLayoutEffect(() => {
    window.scrollTo(0, scrolls.current[viewKey] ?? 0);
  }, [viewKey]);

  if (!config.gameDir || editingDir) {
    return (
      <Setup
        current={config.gameDir}
        onDone={(gameDir) => {
          onConfig({ ...config, gameDir });
          setEditingDir(false);
        }}
        onCancel={config.gameDir ? () => setEditingDir(false) : undefined}
      />
    );
  }

  const normalizeTerm = (raw: string) => raw.trim().replace(/^#+/, "").replace(/\s+/g, "");

  const searchTag = (raw: string) => {
    // Une nouvelle recherche repart en haut : la position d'avant ne veut plus
    // rien dire une fois la liste remplacée.
    scrolls.current.browse = 0;
    goTo(() => {
      setOpenSkin(null);
      setAuthor(null);
      setTab("browse");
      setTerm(normalizeTerm(raw));
    });
  };

  const toggleFavorite = async (a: { id: number; nickname: string; avatar: string }) => {
    const favorites = await api.config.toggleFavorite({
      id: a.id,
      nickname: a.nickname,
      avatar: a.avatar,
    });
    onConfig({ ...config, favorites });
  };

  const showAuthor = (skin: Skin) => {
    goTo(() => {
      setOpenSkin(null);
      setAuthor(skin.author);
    });
  };

  /** Changer de type remet la recherche à zéro : un hashtag de camouflage
   *  n'a pas de sens sur les viseurs, et les filtres véhicule non plus. */
  const switchContent = (next: ContentType) => {
    if (next === content) return;
    goTo(() => {
      setOpenSkin(null);
      setAuthor(null);
      setTab("browse");
      setTerm("");
      setContent(next);
    });
  };

  const go = (next: Tab) => {
    goTo(() => {
      setAuthor(null);
      setTab(next);
    });
  };

  return (
    <div className="app">
      <aside className="rail">
        <Brand />

        <nav className="nav">
          <button
            className={
              tab === "browse" && content === "camouflage" && !author ? "nav-item active" : "nav-item"
            }
            onClick={() => switchContent("camouflage")}
          >
            <IconSearch size={16} />
            {t("contentCamouflages")}
          </button>
          <button
            className={
              tab === "browse" && content === "sight" && !author ? "nav-item active" : "nav-item"
            }
            onClick={() => switchContent("sight")}
          >
            <IconSight size={16} />
            {t("navSights")}
          </button>
          <button
            className={
              tab === "browse" && content === "sound" && !author ? "nav-item active" : "nav-item"
            }
            onClick={() => switchContent("sound")}
          >
            <IconSound size={16} />
            {t("navSounds")}
          </button>
          {/* Les réglages audio ne sont pas du contenu à parcourir : ils disent
              quel mod déjà téléchargé occupe quelle place dans le jeu. */}
          <button
            className={tab === "audio" && !author ? "nav-item active" : "nav-item"}
            onClick={() => go("audio")}
          >
            <IconAudioSettings size={16} />
            {t("tabAudioSettings")}
          </button>
          <button
            className={tab === "installed" ? "nav-item active" : "nav-item"}
            onClick={() => go("installed")}
          >
            <IconDownload size={16} />
            {t("tabInstalled")}
            {/* Le total, pas filtré par le type actif : l'onglet Installés
                montre désormais tout ensemble. */}
            <span className="nav-count">{config.installed.length}</span>
          </button>
          <button
            className={tab === "favorites" && !author ? "nav-item active" : "nav-item"}
            onClick={() => go("favorites")}
          >
            <IconInfo size={16} />
            {t("favorites")}
            <span className="nav-count">{config.favorites.length}</span>
          </button>
        </nav>

        <div className="rail-foot">
          <span className="rail-label">{t("gameFolder")}</span>
          <span className="rail-path" title={config.gameDir}>
            {config.gameDir}
          </span>
          <div className="rail-actions">
            <button className="btn" onClick={() => api.openSkinsFolder()}>
              <IconFolder size={13} />
              {t("open")}
            </button>
            <button className="btn" onClick={() => setEditingDir(true)}>
              {t("change")}
            </button>
          </div>
          <LanguageSwitch />
        </div>
      </aside>

      <div className="main">
        {/* Browse reste monté et se cache : c'est ce qui préserve ses pages et
            son défilement quand on part voir un auteur puis qu'on revient. */}
        <div hidden={!!author || tab !== "browse"}>
          <Browse
            term={term}
            onTerm={(raw) => setTerm(normalizeTerm(raw))}
            onLink={(raw) => {
              const link = parseDeepLink(raw);
              if (!link) return false;
              void openLink(link);
              return true;
            }}
            onOpen={setOpenSkin}
            onAuthor={showAuthor}
          />
        </div>

        {author ? (
          <AuthorView
            author={author}
            isFavorite={config.favorites.some((f) => f.id === author.id)}
            onToggleFavorite={() => toggleFavorite(author)}
            onBack={() => goTo(() => setAuthor(null))}
            onOpen={setOpenSkin}
            onTag={searchTag}
          />
        ) : tab === "browse" ? null : tab === "audio" ? (
          <Mixer
            records={config.installed}
            onRecords={(next) => onConfig({ ...config, installed: next })}
          />
        ) : tab === "favorites" ? (
          <Favorites
            favorites={config.favorites}
            onOpen={(f) => goTo(() => setAuthor({ id: f.id, nickname: f.nickname, avatar: f.avatar }))}
            onSkin={setOpenSkin}
            onTag={searchTag}
            onAuthor={showAuthor}
          />
        ) : (
          <Installed
            records={config.installed}
            onRecords={(next) => onConfig({ ...config, installed: next })}
            onOpen={setOpenSkin}
            onAuthor={showAuthor}
          />
        )}
      </div>

      {openSkin && (
        <Detail
          skin={openSkin}
          onTag={searchTag}
          onAuthor={showAuthor}
          isFavorite={config.favorites.some((f) => f.id === openSkin.author.id)}
          onToggleFavorite={() => toggleFavorite(openSkin.author)}
          onClose={() => setOpenSkin(null)}
        />
      )}

      <div className="toasts">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.kind}`}>
            {toast.msg}
          </div>
        ))}
      </div>
    </div>
  );
}
