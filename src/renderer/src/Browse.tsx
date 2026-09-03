/**
 * Navigation : recherche par hashtag, filtres en cascade, tri, pagination.
 * L'installation est orchestrée par le shell, pas ici.
 */

import { Fragment, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  api,
  buildOptions,
  FILTER_KEYS,
  SORTS,
  type ContentType,
  type FilterKey,
  type Option,
  type Selection,
  type Skin,
  type SortKey,
  type Taxonomy,
} from "./api";
import { LoadMore, PageBadge, useInfiniteFeed } from "./feed";
import { IconClose, IconInfo } from "./icons";
import { HoverPreview, useHoverTarget } from "./HoverPreview";
import { CardSkeletons, SkinCard } from "./SkinCard";
import { useShell } from "./shell";
import { parseDeepLink } from "../../shared/deepLink";

/**
 * Libellés des quatre filtres. Ils viennent de NOUS, pas de l'API.
 *
 * `get_head` renvoie bien un `placeholder` par filtre, mais toujours en anglais.
 * Les VALEURS de la taxonomie (« Germany », « Medium tanks », 3 191 véhicules)
 * sont des données de Live et restent dans sa langue — les traduire voudrait
 * dire maintenir un dictionnaire qui bouge à chaque mise à jour du jeu. Les
 * quatre libellés, eux, sont un ensemble fermé : rien ne justifie de les laisser
 * en anglais.
 */
const FILTER_LABEL = {
  vehicleCountry: "filterCountry",
  vehicleType: "filterType",
  vehicleClass: "filterClass",
  vehicle: "filterVehicle",
} as const;

/**
 * Combobox filtrable ET scrollable.
 *
 * Aucun contrôle natif ne fait les deux : <select> scrolle mais ne se filtre
 * pas au clavier, <datalist> filtre mais Chromium plafonne les suggestions
 * affichées sans liste déroulante derrière. Avec 3200 véhicules il faut les
 * deux, d'où cette implémentation.
 */
function Combo({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useShell();
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.display.toLowerCase().includes(q)) : options;
  }, [options, query]);

  // Regroupement par séparateur. Les en-têtes ne s'affichent que s'il y a
  // plusieurs groupes : une nation déjà choisie n'en laisse qu'un.
  const groups = useMemo(() => {
    const map = new Map<string, Option[]>();
    for (const o of shown) map.set(o.group, [...(map.get(o.group) ?? []), o]);
    return [...map.entries()];
  }, [shown]);
  const showHeaders = groups.length > 1;

  const flatIndex = useMemo(() => new Map(shown.map((o, i) => [o.value, i])), [shown]);

  useEffect(() => setActive(0), [query, open]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function choose(o: Option) {
    onChange(o.value);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) return setOpen(true);
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => Math.min(Math.max(i + delta, 0), shown.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (open && shown[active]) choose(shown[active]);
      else setOpen(true);
    } else if (e.key === "Escape") {
      setQuery("");
      setOpen(false);
    }
  }

  return (
    <div className="combo" ref={boxRef}>
      <span className="field-label">
        {label}
        <span className="combo-count">{options.length}</span>
      </span>

      <div className="combo-field">
        <input
          className={selected ? "input set" : "input"}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={open ? query : selected?.display ?? ""}
          placeholder={open ? selected?.display ?? t("all") : t("all")}
          spellCheck={false}
          onFocus={() => {
            setQuery("");
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
        {selected && (
          <button
            className="combo-clear"
            onClick={() => {
              onChange("");
              setQuery("");
            }}
            aria-label={t("removeFilter")}
            title={t("removeFilter")}
          >
            <IconClose size={10} />
          </button>
        )}
      </div>

      {open && (
        <ul
          className="combo-list"
          id={listId}
          role="listbox"
          ref={listRef}
          onMouseDown={(e) => e.preventDefault()}
        >
          {shown.length === 0 && <li className="combo-empty">{t("noMatch")}</li>}
          {groups.map(([groupName, items]) => (
            <Fragment key={groupName || "_"}>
              {showHeaders && groupName && (
                <li className="combo-group" role="presentation">
                  {groupName}
                </li>
              )}
              {items.map((o) => {
                const i = flatIndex.get(o.value)!;
                return (
                  <li key={o.value} className="combo-item">
                    <button
                      className={i === active ? "combo-option active" : "combo-option"}
                      data-active={i === active}
                      role="option"
                      aria-selected={o.value === value}
                      onClick={() => choose(o)}
                      onMouseEnter={() => setActive(i)}
                    >
                      {o.display}
                    </button>
                  </li>
                );
              })}
            </Fragment>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Props {
  onOpen: (skin: Skin) => void;
  onAuthor: (skin: Skin) => void;
  /** Terme imposé de l'extérieur (clic sur un hashtag depuis la fiche). */
  term: string;
  onTerm: (term: string) => void;
  /** Un lien Live collé ici est ouvert au lieu d'être cherché. */
  onLink: (raw: string) => boolean;
}

export function Browse({ onOpen, onAuthor, term, onTerm, onLink }: Props) {
  const { t, content } = useShell();
  const [taxonomy, setTaxonomy] = useState<Taxonomy | null>(null);
  const [taxonomyError, setTaxonomyError] = useState(false);
  const [sel, setSel] = useState<Selection>({});
  const [sort, setSort] = useState<SortKey>("rating");
  const [draft, setDraft] = useState(term);
  const gridRef = useRef<HTMLDivElement>(null);
  const hover = useHoverTarget();

  useEffect(() => setDraft(term), [term]);

  useEffect(() => {
    api.content
      .filters(content)
      .then(setTaxonomy)
      .catch(() => setTaxonomyError(true));
  }, [content]);

  const applied = term ? `#${term}` : "";

  /**
   * Coller un lien Live ici l'ouvre au lieu de le chercher.
   *
   * C'est le seul moyen d'ouvrir dans l'app un lien reçu par ailleurs : une
   * application ne peut pas intercepter les URL https sans être le navigateur
   * par défaut. Un lien reconnu vide le champ, il n'a rien à y faire.
   */
  function submit() {
    if (parseDeepLink(draft) && onLink(draft)) {
      setDraft("");
      return;
    }
    onTerm(draft);
  }

  // Tout ce qui doit relancer la liste tient dans cette cle.
  const feedKey = JSON.stringify([content, applied, sort, sel]);
  const feed = useInfiniteFeed(feedKey, (page) =>
    api.content
      .search({
        content,
        sort,
        page,
        searchString: applied,
        vehicleCountry: sel.vehicleCountry ?? "",
        vehicleType: sel.vehicleType ?? "",
        vehicleClass: sel.vehicleClass ?? "",
        vehicle: sel.vehicle ?? "",
      })
      .then((p) => p.data.list)
  );

  // Changer un filtre invalide les sélections qui en dépendent : garder
  // "Spitfire" après être passé aux chars ne renverrait rien.
  const pick = useCallback((key: FilterKey, value: string) => {
    setSel((prev) => {
      const next: Selection = { ...prev, [key]: value || undefined };
      if (key === "vehicleType") {
        delete next.vehicleClass;
        delete next.vehicle;
      }
      if (key === "vehicleClass" || key === "vehicleCountry") delete next.vehicle;
      return next;
    });
  }, []);

  const options = useMemo(() => {
    const out = {} as Record<FilterKey, Option[]>;
    for (const key of FILTER_KEYS) {
      out[key] = taxonomy ? buildOptions(taxonomy[key]?.variants ?? [], sel) : [];
    }
    return out;
  }, [taxonomy, sel]);

  const activeFilters = Object.values(sel).filter(Boolean).length + (applied ? 1 : 0);

  return (
    <>
      <div className="topbar">
      <div className="toolbar">
        <div className="combo">
          <span className="field-label">{t("hashtag")}</span>
          <div className="row">
            <div className="combo-field">
              <input
                className={applied ? "input set" : "input"}
                value={draft}
                placeholder={t("hashtagPlaceholder")}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit();
                  // Échap vide le champ ET la recherche appliquée : sinon on
                  // efface le texte mais les résultats restent filtrés.
                  if (e.key === "Escape") {
                    setDraft("");
                    onTerm("");
                  }
                }}
                spellCheck={false}
              />
              {(draft || applied) && (
                <button
                  className="combo-clear"
                  onClick={() => {
                    setDraft("");
                    onTerm("");
                  }}
                  aria-label={t("clearSearch")}
                  title={t("clearSearch")}
                >
                  <IconClose size={10} />
                </button>
              )}
            </div>
            <button className="btn" onClick={submit}>
              {t("search")}
            </button>
          </div>
        </div>

        <label className="combo">
          <span className="field-label">{t("sortBy")}</span>
          <select
            className="select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {t(s.key)}
              </option>
            ))}
          </select>
        </label>

        {taxonomy
          ? FILTER_KEYS.map((key) => (
              <Combo
                key={key}
                label={t(FILTER_LABEL[key])}
                options={options[key]}
                value={sel[key] ?? ""}
                onChange={(v) => pick(key, v)}
              />
            ))
          : !taxonomyError &&
            FILTER_KEYS.map((key) => (
              <div className="combo" key={key}>
                <span className="field-label">&nbsp;</span>
                <div className="combo-skeleton" />
              </div>
            ))}

        {activeFilters > 0 && (
          <button
            className="btn ghost reset"
            onClick={() => {
              setSel({});
              onTerm("");
            }}
          >
            {t("reset")} ({activeFilters})
          </button>
        )}
      </div>

      </div>

      <div className="content">
      {taxonomyError && (
        <p className="banner">
          <IconInfo size={14} />
          {t("filtersFailed")}
        </p>
      )}

      {applied && (
        <p className="muted result-note">
          {t("searchingOn", { tag: applied })} {t("hashtagNote")}
        </p>
      )}

      {feed.error && feed.items.length === 0 ? (
        <div className="empty">
          <p className="error">{feed.error}</p>
          <button className="btn" onClick={feed.retry}>
            {t("retry")}
          </button>
        </div>
      ) : feed.loading ? (
        <CardSkeletons />
      ) : feed.items.length === 0 ? (
        <div className="empty">
          <p>{t("noResults")}</p>
          <p className="muted">{applied ? t("noResultsHashtag") : t("noResultsFilters")}</p>
          <p className="muted">{t("pasteHint")}</p>
          {activeFilters > 0 && (
            <button className="btn" onClick={() => { setSel({}); onTerm(""); }}>
              {t("resetFilters")}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="grid" ref={gridRef}>
            {feed.items.map((skin, i) => (
              <SkinCard
                key={skin.id}
                skin={skin}
                page={feed.pageOf[i]}
                onOpen={() => onOpen(skin)}
                onTag={onTerm}
                onAuthor={onAuthor}
                onHover={hover.enter}
                onHoverEnd={hover.leave}
              />
            ))}
          </div>

          <LoadMore onReach={feed.loadMore} disabled={feed.done || feed.appending} />

          {feed.appending && (
            <p className="loading-inline feed-foot">
              <span className="spinner" /> {t("loading")}
            </p>
          )}
          {/* Une erreur survenue en cours de defilement ne doit pas effacer ce
              qui est deja charge : on propose de reessayer sous la grille. */}
          {feed.error && (
            <p className="feed-foot">
              <span className="error">{feed.error}</span>{" "}
              <button className="link" onClick={feed.retry}>
                {t("retry")}
              </button>
            </p>
          )}
          {feed.done && <p className="muted feed-foot">{t("endOfList")}</p>}

          <PageBadge gridRef={gridRef} total={feed.items.length} />
          <HoverPreview target={hover.target} />
        </>
      )}
      </div>

    </>
  );
}
