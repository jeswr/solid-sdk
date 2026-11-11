// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";
import { en } from "@jeswr/suite-i18n";
import { useT } from "@jeswr/suite-i18n/react";
import {
  Button,
  EmptyState,
  ErrorState,
  FilterChips,
  LoadingSkeleton,
  ProvenanceBadge,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@jeswr/suite-ui";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { DOMAINS, UNCATEGORISED, visibleDomains } from "../lib/model/domains";
import {
  connectedSources,
  connectorsForDomain,
  parseTypes,
  relativeTime,
  sectionsFor,
  serializeTypes,
} from "../state/presentation";
import { useDomainItems } from "../state/use-domain-items";
import { useHomeAccess } from "../state/use-home-access";
import { DomainIcon } from "./domain-icon";
import { DomainNavigation } from "./domain-navigation";
import { useHomeSession } from "./home-app";
import { HomeCard } from "./home-card";
import { HomeHeader } from "./home-header";
import { AddManuallySheet } from "./item/add-manually-sheet";
import { itemShortcut } from "./item/shortcuts";
import { useItemActions } from "./item/use-item-actions";

export function HomePage({ domain }: { domain: string }) {
  const t = useT();
  const session = useHomeSession();
  const loaded = useDomainItems(session);
  const access = useHomeAccess(session, loaded.updated);
  const { hidden } = useItemActions(session);
  const visibleItems = loaded.items.filter((item) => !hidden.has(item.url));
  const data = {
    ...loaded,
    items: visibleItems,
    counts: new Map(
      [...loaded.counts.keys()].map((id) => [
        id,
        visibleItems.filter((item) => item.domain.id === id).length,
      ]),
    ),
  };
  const entry = DOMAINS.find((candidate) => candidate.id === domain) ?? UNCATEGORISED;
  const search = useSearchParams();
  const pathname = usePathname();
  const selected = parseTypes(search.get("types"), entry);
  const [page, setPage] = useState({ domain, filter: search.get("types"), limit: 24 });
  const limit = page.domain === domain && page.filter === search.get("types") ? page.limit : 24;
  const items = data.items.filter((item) => item.domain.id === entry.id);
  const sections = sectionsFor(entry, items, selected, limit).map((section) => ({
    ...section,
    label: Object.hasOwn(en.home.types, section.id)
      ? t(`home.types.${section.id as keyof typeof en.home.types}`)
      : section.label,
  }));
  const sources = connectedSources(items, session.storageUrl);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    const clock = setInterval(() => setNow(Date.now()), 60_000);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
      clearInterval(clock);
    };
  }, []);
  const filter = (types: string[]) => {
    const query = new URLSearchParams(search.toString());
    const value = serializeTypes(types, entry);
    if (value === null) query.delete("types");
    else query.set("types", value);
    // Shallow update: the app router syncs useSearchParams with history.replaceState,
    // which (unlike router.replace) also works on a prerendered page opened with a query.
    window.history.replaceState(null, "", `${pathname}${query.size ? `?${query}` : ""}`);
  };
  const [adding, setAdding] = useState(search.get("add") === "1");
  const returnTarget = useRef<HTMLElement | null>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const canAdd = entry.dataTypes.some((type) => type.manualForm);
  const openAdd = () => {
    returnTarget.current = document.activeElement as HTMLElement;
    setAdding(true);
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "a" && canAdd && !adding && itemShortcut(event)) {
        event.preventDefault();
        returnTarget.current = document.activeElement as HTMLElement;
        setAdding(true);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [canAdd, adding]);
  const connect = `/connect?domain=${entry.id}`;
  const retry = () => void data.refresh();
  return (
    <div className="hm-page">
      {data.refreshing ? (
        <div className="hm-progress" role="progressbar" aria-label="Updating your data" />
      ) : null}
      <span className="suite-sr-only" role="status" aria-live="polite" aria-atomic="true">
        {data.updated ? `Updated${"\u200b".repeat(data.updated % 2)}` : ""}
      </span>
      <HomeHeader
        displayName={session.displayName}
        items={data.items}
        used={data.used}
        access={access}
        status={data.status}
        now={now}
        offline={!online}
        asOf={data.loadedAt}
        onRetry={retry}
      />
      <DomainNavigation
        domains={visibleDomains(data.items)}
        active={entry.id}
        counts={data.counts}
      />
      <section className="hm-domain-content" aria-labelledby="hm-domain-heading">
        <div className="hm-domain-heading">
          <h2 id="hm-domain-heading">
            <DomainIcon name={entry.icon} size={24} />
            {Object.hasOwn(en.home.domains, entry.id)
              ? t(`home.domains.${entry.id as keyof typeof en.home.domains}`)
              : entry.label}
          </h2>
          {canAdd ? (
            <Button ref={addButton} variant="outline" onClick={openAdd} disabled={!online}>
              Add manually
            </Button>
          ) : null}
        </div>
        {!online && data.items.length ? (
          <p className="hm-notice" role="status">
            Showing saved copies
          </p>
        ) : null}
        <FilterChips
          label={`${Object.hasOwn(en.home.domains, entry.id) ? t(`home.domains.${entry.id as keyof typeof en.home.domains}`) : entry.label} data types`}
          options={entry.dataTypes}
          value={selected}
          onChange={filter}
          resultCount={
            items.filter(
              (item) => !entry.dataTypes.length || selected.includes(item.dataType?.id ?? ""),
            ).length
          }
        />
        {connectorsForDomain(entry.id).length ? (
          <div className="hm-sources">
            {sources.length ? <span className="hm-muted">Connected</span> : null}
            <TooltipProvider>
              {sources.map((source) => (
                <Tooltip key={source.id}>
                  <TooltipTrigger asChild>
                    <button type="button" className="hm-source">
                      <ProvenanceBadge source={source.label} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {source.label} · synced{" "}
                    {source.modified ? relativeTime(source.modified, now) : "time unknown"}
                  </TooltipContent>
                </Tooltip>
              ))}
            </TooltipProvider>
            <Button variant="secondary" asChild>
              <Link href={connect}>Connect more services</Link>
            </Button>
          </div>
        ) : null}
        {data.status === "offline" ? (
          <EmptyState
            variant="not-available-offline"
            body="Reconnect to load your data."
            onRetry={retry}
          />
        ) : data.status === "loading" ? (
          <LoadingSkeleton preset="grid" count={6} label="Loading your data" />
        ) : data.status === "error" ? (
          <ErrorState error="unreachable" actions={{ retry }} />
        ) : (
          <>
            {data.failures.length ? (
              <p className="hm-notice" role="status">
                Some items couldn't be loaded{" "}
                <Button variant="outline" onClick={retry}>
                  Retry
                </Button>
              </p>
            ) : null}
            {data.truncated ? (
              <p className="hm-notice">
                Showing the items loaded so far.{" "}
                <Button variant="outline" onClick={retry}>
                  Retry
                </Button>
              </p>
            ) : null}
            {!items.length ? (
              <EmptyState
                title={t("home.empty")}
                body="Connect a service or add something yourself."
                icon={<DomainIcon name={entry.icon} size={32} />}
                primaryAction={
                  <Button asChild>
                    <Link href={connect}>Connect a service</Link>
                  </Button>
                }
                secondaryAction={
                  entry.dataTypes.some((type) => type.manualForm) ? (
                    <Button variant="outline" onClick={openAdd} disabled={!online}>
                      Add manually
                    </Button>
                  ) : undefined
                }
              />
            ) : !sections.length ? (
              <EmptyState
                variant="filtered-empty"
                title={t("home.noMatches")}
                onClearFilters={() => filter(entry.dataTypes.map((type) => type.id))}
              />
            ) : (
              sections
                .filter((section) => section.items.length)
                .map((section) => (
                  <section
                    key={section.id}
                    className="hm-section"
                    aria-labelledby={`hm-section-${section.id}`}
                  >
                    <div className="hm-section-heading">
                      <h3 id={`hm-section-${section.id}`}>{section.label}</h3>
                      {section.app ? (
                        <Link href={section.app.href}>Open in {section.app.label}</Link>
                      ) : null}
                    </div>
                    {/* biome-ignore lint/a11y/noRedundantRoles: preserve list semantics in Safari with list-style none */}
                    <ul className="hm-grid" role="list" aria-label={`${section.label} items`}>
                      {section.items.map((item) => (
                        <HomeCard
                          key={`${item.url}|${item.dataType?.id}`}
                          item={item}
                          view={
                            data.views.get(item) as NonNullable<ReturnType<typeof data.views.get>>
                          }
                          storage={session.storageUrl}
                          webId={session.webId}
                        />
                      ))}
                    </ul>
                  </section>
                ))
            )}
            {sections.some((section) => section.hasMore) ? (
              <Button
                variant="outline"
                onClick={() => setPage({ domain, filter: search.get("types"), limit: limit + 24 })}
              >
                Show more
              </Button>
            ) : null}
          </>
        )}
      </section>
      {canAdd ? (
        <AddManuallySheet
          key={domain}
          domain={entry}
          open={adding}
          onOpenChange={setAdding}
          returnFocus={() => {
            const target = returnTarget.current;
            if (target?.isConnected && target !== document.body) target.focus();
            else addButton.current?.focus();
          }}
        />
      ) : null}
    </div>
  );
}
