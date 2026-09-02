/**
 * Défilement infini partagé par la recherche et la page auteur.
 *
 * Live ne donne aucun total : on ne peut donc ni afficher « page 3 sur 12 », ni
 * savoir d'avance quand s'arrêter. La seule fin de liste détectable est une
 * page incomplète — ou vide côté auteur, dont le filtrage par type peut vider
 * une page pleine sans que ce soit la dernière.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Skin } from "./api";
import { useShell } from "./shell";

const PAGE_SIZE = 25;

export interface Feed {
  items: Skin[];
  /** Numéro de page (base 1) de chaque item, pour l'étiquette flottante. */
  pageOf: number[];
  loading: boolean; // premier chargement, la grille est vide
  appending: boolean; // page suivante en cours, la grille est déjà remplie
  done: boolean;
  error: string;
  loadMore: () => void;
  retry: () => void;
}

/**
 * @param key   change ⇒ on repart de zéro (filtres, tri, hashtag, auteur)
 * @param load  récupère une page ; l'identité de la fonction n'a pas à être stable
 */
export function useInfiniteFeed(
  key: string,
  load: (page: number) => Promise<Skin[]>,
  opts: { stopOnEmpty?: boolean } = {}
): Feed {
  const [items, setItems] = useState<Skin[]>([]);
  const [pageOf, setPageOf] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [appending, setAppending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  const loadRef = useRef(load);
  loadRef.current = load;

  // Une réponse lente d'un filtre abandonné ne doit jamais s'ajouter à la
  // liste du filtre courant : chaque `key` ouvre une génération, les réponses
  // des générations précédentes sont jetées.
  const gen = useRef(0);
  const nextPage = useRef(0);
  const busy = useRef(false);

  const fetchPage = useCallback(
    async (page: number, mine: number) => {
      if (busy.current) return;
      busy.current = true;
      if (page === 0) setLoading(true);
      else setAppending(true);
      setError("");

      try {
        const list = await loadRef.current(page);
        if (mine !== gen.current) return;

        setItems((prev) => (page === 0 ? list : [...prev, ...list]));
        setPageOf((prev) => {
          const marks = list.map(() => page + 1);
          return page === 0 ? marks : [...prev, ...marks];
        });

        // Page incomplète = fin de liste. Côté auteur le filtrage par type peut
        // vider une page pleine, d'où `stopOnEmpty` : on ne s'arrête que sur
        // une page réellement vide.
        const finished = opts.stopOnEmpty ? list.length === 0 : list.length < PAGE_SIZE;
        if (finished) setDone(true);
        nextPage.current = page + 1;
      } catch (e) {
        if (mine === gen.current) setError(String((e as Error)?.message ?? e));
      } finally {
        busy.current = false;
        if (mine === gen.current) {
          setLoading(false);
          setAppending(false);
        }
      }
    },
    [opts.stopOnEmpty]
  );

  useEffect(() => {
    const mine = ++gen.current;
    busy.current = false;
    nextPage.current = 0;
    setItems([]);
    setPageOf([]);
    setDone(false);

    // Une liste neuve commence en haut. Sans ça, arriver sur une vue depuis le
    // bas d'une autre — cliquer un auteur après avoir fait défiler la recherche
    // — laisse la sentinelle à l'écran, et les pages s'enchaînent toutes seules
    // jusqu'à épuisement du catalogue.
    window.scrollTo(0, 0);

    void fetchPage(0, mine);
    // `key` résume à lui seul tout ce qui doit provoquer un rechargement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const loadMore = useCallback(() => {
    if (done || busy.current) return;
    void fetchPage(nextPage.current, gen.current);
  }, [done, fetchPage]);

  const retry = useCallback(() => {
    void fetchPage(nextPage.current, gen.current);
  }, [fetchPage]);

  return { items, pageOf, loading, appending, done, error, loadMore, retry };
}

/**
 * Déclencheur de chargement placé sous la grille. La marge basse anticipe :
 * la page suivante part avant que le sentinelle n'entre à l'écran, pour que le
 * défilement ne butte pas sur un vide.
 */
export function LoadMore({ onReach, disabled }: { onReach: () => void; disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const cb = useRef(onReach);
  cb.current = onReach;

  useEffect(() => {
    const el = ref.current;
    if (!el || disabled) return;
    const io = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && cb.current(),
      { rootMargin: "600px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [disabled]);

  return <div ref={ref} className="load-more" aria-hidden="true" />;
}

/**
 * Étiquette flottante en bas à droite : la page à laquelle on se trouve.
 *
 * Elle se lit du DOM plutôt que d'un état React — la carte visible la plus
 * haute porte son numéro de page en attribut. Un observateur par carte serait
 * plus lourd pour le même résultat.
 */
export function PageBadge({
  gridRef,
  total,
}: {
  gridRef: React.RefObject<HTMLDivElement | null>;
  total: number;
}) {
  const { t } = useShell();
  const [page, setPage] = useState(1);

  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const grid = gridRef.current;
      if (!grid) return;
      for (const child of grid.children) {
        const rect = (child as HTMLElement).getBoundingClientRect();
        // Première carte dont le bas passe sous l'en-tête collant.
        if (rect.bottom > 80) {
          const n = Number((child as HTMLElement).dataset.page);
          if (n) setPage(n);
          return;
        }
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [gridRef, total]);

  if (total === 0) return null;
  return (
    <div className="page-badge" role="status" aria-live="polite">
      {t("page", { n: page })}
    </div>
  );
}
