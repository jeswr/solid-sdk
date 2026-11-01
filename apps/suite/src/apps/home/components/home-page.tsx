// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";
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
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
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
import { DomainIcon } from "./domain-icon";
import { DomainNavigation } from "./domain-navigation";
import { useHomeSession } from "./home-app";
import { HomeCard } from "./home-card";
import { HomeHeader } from "./home-header";

export function HomePage({ domain }: { domain: string }) {
  const session = useHomeSession();
  const data = useDomainItems(session);
  const entry = DOMAINS.find((candidate) => candidate.id === domain) ?? UNCATEGORISED;
  const search = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const selected = parseTypes(search.get("types"), entry);
  const [page, setPage] = useState({ domain, filter: search.get("types"), limit: 24 });
  const limit = page.domain === domain && page.filter === search.get("types") ? page.limit : 24;
  const items = data.items.filter((item) => item.domain.id === entry.id);
  const sections = sectionsFor(entry, items, selected, limit);
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
    router.replace(`${pathname}${query.size ? `?${query}` : ""}`, { scroll: false });
  };
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
        status={data.status}
        now={now}
        onRetry={retry}
      />
      <DomainNavigation
        domains={visibleDomains(data.items)}
        active={entry.id}
        counts={data.counts}
      />
      <section className="hm-domain-content" aria-labelledby="hm-domain-heading">
        <h2 id="hm-domain-heading">
          <DomainIcon name={entry.icon} size={24} />
          {entry.label}
        </h2>
        {!online ? (
          <p className="hm-notice" role="status">
            Showing saved copies
          </p>
        ) : null}
        <FilterChips
          label={`${entry.label} data types`}
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
        {data.status === "loading" ? (
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
                title="Nothing here yet"
                body="Connect a service or add something yourself."
                icon={<DomainIcon name={entry.icon} size={32} />}
                primaryAction={
                  <Button asChild>
                    <Link href={connect}>Connect a service</Link>
                  </Button>
                }
                secondaryAction={
                  entry.dataTypes.some((type) => type.manualForm) ? (
                    <Button variant="outline" asChild>
                      <Link href={`${pathname}?add=1`}>Add manually</Link>
                    </Button>
                  ) : undefined
                }
              />
            ) : !sections.length ? (
              <EmptyState
                variant="filtered-empty"
                title="No items match these filters"
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
    </div>
  );
}
