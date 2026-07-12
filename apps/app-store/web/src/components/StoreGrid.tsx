// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// StoreGrid — the search/filter bar + the category-grouped card grid. All filtering
// is pure client-side over the build-time catalog (matchesQuery / groupByCategory):
//   - a free-text search box (name + description + category + id, AND over tokens);
//   - a "Live only" toggle (default ON, since 7 of 17 apps are not-yet-live).
import { useId, useMemo, useState } from "react";
import { type AppEntry, groupByCategory, isLive, matchesQuery } from "../lib/catalog";
import { AppCard } from "./AppCard";

export function StoreGrid({ apps, webId }: { apps: AppEntry[]; webId: string | null }) {
  const [query, setQuery] = useState("");
  const [liveOnly, setLiveOnly] = useState(true);
  const searchId = useId();
  const liveId = useId();

  const groups = useMemo(() => {
    const filtered = apps.filter((app) => matchesQuery(app, query) && (!liveOnly || isLive(app)));
    return groupByCategory(filtered);
  }, [apps, query, liveOnly]);

  const total = groups.reduce((n, [, list]) => n + list.length, 0);

  return (
    <section className="store-grid-section" aria-label="App catalog">
      <div className="store-controls">
        <div className="store-search">
          <label htmlFor={searchId}>Search apps</label>
          <input
            id={searchId}
            type="search"
            inputMode="search"
            placeholder="Search by name, description, or category…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <label className="store-livetoggle" htmlFor={liveId}>
          <input
            id={liveId}
            type="checkbox"
            checked={liveOnly}
            onChange={(e) => setLiveOnly(e.target.checked)}
          />
          Live only
        </label>
      </div>

      {total === 0 ? (
        <p className="store-empty" role="status">
          No apps match “{query}”{liveOnly ? " — try turning off “Live only”." : "."}
        </p>
      ) : (
        groups.map(([category, list]) => (
          <div className="store-category" key={category}>
            <h2 className="store-category-title">
              {category} <span className="store-category-count">{list.length}</span>
            </h2>
            <div className="store-cards">
              {list.map((app) => (
                <AppCard key={app.id} app={app} webId={webId} />
              ))}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
