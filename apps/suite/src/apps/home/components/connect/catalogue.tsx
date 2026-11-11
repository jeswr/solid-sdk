// AUTHORED-BY Codex GPT-6
"use client";
import { FilterChips } from "@jeswr/suite-ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { AppHeading } from "@/shell/app-frame";
import { filterCatalogue } from "../../lib/connect/catalogue";
import { relativeSync } from "../../lib/connect/copy";
import { DOMAINS, UNCATEGORISED } from "../../lib/model/domains";
import { useConnectors } from "../../state/connectors";
import { useHomeSession } from "../home-app";
import { entries } from "./config";
import { ConnectorLogo, StatusBadge } from "./shared";
import { useOnline } from "./use-online";

const domains = [...DOMAINS, UNCATEGORISED];
export function ConnectCatalogue() {
  const session = useHomeSession();
  const [connections] = useConnectors(session.webId);
  const online = useOnline();
  const params = useSearchParams();
  const selected = (params.get("domain") ?? "")
    .split(",")
    .filter((id) => domains.some((domain) => domain.id === id));
  const [search, setSearch] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const refresh = setInterval(() => setNow(Date.now()), 60000);
    const onKey = (event: KeyboardEvent) => {
      if (
        event.key !== "n" ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        event.shiftKey
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="combobox"],dialog,[role="dialog"]',
        )
      )
        return;
      try {
        if (localStorage.getItem("suite.settings.shortcuts") === "off") return;
      } catch {
        // Storage can be unavailable in restricted browser contexts.
      }
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(refresh);
      window.removeEventListener("keydown", onKey);
    };
  }, []);
  const visible = filterCatalogue(entries, selected, search);
  return (
    <div className="hm-connect hm-connect-page">
      <header>
        <AppHeading>Connect services</AppHeading>
        <p>Bring your data from other services into your pod.</p>
      </header>
      {/* Always mounted, so going offline is announced when the note appears. */}
      <div role="status" aria-live="polite">
        {!online && (
          <p className="hm-connect-offline">You're offline. Reconnect to connect services.</p>
        )}
      </div>
      <div className="hm-connect-search">
        <label htmlFor="connector-search">Search services</label>
        <input
          id="connector-search"
          ref={input}
          type="search"
          placeholder="Search services"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <FilterChips
        label="Filter services by domain"
        options={domains}
        value={selected}
        resultCount={visible.length}
        onChange={(value) => {
          const next = new URLSearchParams(params.toString());
          if (value.length) next.set("domain", value.join(","));
          else next.delete("domain");
          // Shallow update: the app router syncs useSearchParams with history.replaceState,
          // which (unlike router.replace) also works on a prerendered page opened with a query.
          window.history.replaceState(null, "", `/connect${next.size ? `?${next}` : ""}`);
        }}
      />
      <div className="hm-connect-grid">
        {visible.map((entry) => {
          const connection = connections[entry.id];
          const disabled = !online || entry.status === "soon";
          const action = connection?.lastSync
            ? "Sync now"
            : entry.status === "demo"
              ? "Try with demo data"
              : entry.status === "import"
                ? "Import a file"
                : entry.status === "soon"
                  ? "Coming soon"
                  : "Connect";
          return (
            <article
              className="hm-connect-card"
              key={entry.id}
              aria-labelledby={`service-${entry.id}`}
            >
              <div className="hm-connect-card-heading">
                <ConnectorLogo entry={entry} />
                <h2 id={`service-${entry.id}`}>{entry.name}</h2>
              </div>
              <p className="hm-connect-description">{entry.whatYouGet}</p>
              <ul className="hm-connect-tags" aria-label="Domains">
                {entry.domains.map((id) => (
                  <li key={id}>{domains.find((domain) => domain.id === id)?.label}</li>
                ))}
              </ul>
              <div>
                <StatusBadge status={entry.status} />
              </div>
              {connection?.lastSync && (
                <p className="hm-connect-sync">
                  <span aria-hidden="true" className="hm-connect-dot" />
                  {relativeSync(connection.lastSync, now)}
                </p>
              )}
              {connection && connection.lastOutcome !== "ok" && (
                <p className="hm-connect-incomplete">Last sync incomplete</p>
              )}
              <div
                className="hm-connect-card-action"
                title={!online ? "Reconnect to connect services" : undefined}
              >
                {disabled ? (
                  <button type="button" className="hm-connect-button" disabled>
                    {action}
                  </button>
                ) : (
                  <Link className="hm-connect-button" href={`/connect/${entry.id}`}>
                    {action}
                    <span className="hm-connect-sr-only"> — {entry.name}</span>
                  </Link>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {!visible.length && (
        <p role="status">
          No services match your search. Try another search or clear your filters.
        </p>
      )}
    </div>
  );
}
