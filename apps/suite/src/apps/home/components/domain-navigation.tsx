// AUTHORED-BY Codex GPT-6
"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import type { DataCategory } from "../lib/model/domains";
import { DOMAINS } from "../lib/model/domains";
import { DomainIcon } from "./domain-icon";
import { domainHref } from "./home-sidebar";

export function DomainNavigation({
  domains,
  active,
  counts,
}: {
  domains: readonly DataCategory[];
  active: string;
  counts: ReadonlyMap<string, number>;
}) {
  const row = useRef<HTMLFieldSetElement>(null);
  const router = useRouter();
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll on route changes and when counts first appear
  useEffect(() => {
    row.current
      ?.querySelector('[aria-current="page"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [active, counts.size]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (target instanceof HTMLElement &&
          target.closest(
            'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="menu"]',
          ))
      )
        return;
      if (!/^[1-9]$/.test(event.key)) return;
      const domain = DOMAINS[Number(event.key) - 1];
      if (domain) {
        event.preventDefault();
        router.push(domainHref(domain.id));
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [router]);
  return (
    <nav className="hm-domain-nav" aria-label="Life domains">
      <fieldset className="hm-domain-row" aria-label="Choose a domain" ref={row}>
        {domains.map((domain) => (
          <Link
            className="hm-domain-tab"
            key={domain.id}
            href={domainHref(domain.id)}
            aria-current={domain.id === active ? "page" : undefined}
          >
            <DomainIcon name={domain.icon} />
            <span>{domain.label}</span>
            {(counts.get(domain.id) ?? 0) > 0 ? (
              <span className="hm-nav-count">
                <span className="hm-sr-only">, </span>
                {counts.get(domain.id)}
                <span className="hm-sr-only"> items</span>
              </span>
            ) : null}
          </Link>
        ))}
      </fieldset>
    </nav>
  );
}
