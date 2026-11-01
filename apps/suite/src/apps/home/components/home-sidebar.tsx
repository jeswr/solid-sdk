// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
"use client";
/**
 * Sidebar shared by /home, /permissions and /connect (03-home-permissions §2.1):
 * the nine domains, then shortcuts to Connect services and Permissions. The
 * same list is the drawer below 1024px.
 */

import { Plug, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOMAINS, UNCATEGORISED } from "../lib/model/domains";
import { DomainIcon } from "./domain-icon";

/** The route for a domain; Personal is the /home landing page. */
export function domainHref(id: string): string {
  return id === "personal" ? "/home" : `/home/${encodeURIComponent(id)}`;
}

/** The domain a /home pathname shows, or undefined outside /home. */
export function domainFromPath(pathname: string): string | undefined {
  if (pathname === "/home" || pathname === "/home/") return "personal";
  const match = /^\/home\/([^/]+)/.exec(pathname);
  return match ? decodeURIComponent(match[1] ?? "") : undefined;
}

export function HomeSidebar({ counts }: { counts?: ReadonlyMap<string, number> }) {
  const pathname = usePathname();
  const active = domainFromPath(pathname);
  return (
    <div className="hm-sidebar">
      <nav aria-label="Your data">
        <ul>
          {[...DOMAINS, ...((counts?.get("other") ?? 0) > 0 ? [UNCATEGORISED] : [])].map(
            (domain) => (
              <li key={domain.id}>
                <Link
                  href={domainHref(domain.id)}
                  className="hm-nav-item"
                  aria-current={active === domain.id ? "page" : undefined}
                >
                  <DomainIcon name={domain.icon} />
                  <span className="hm-nav-label">{domain.label}</span>
                  {(counts?.get(domain.id) ?? 0) > 0 ? (
                    <span className="hm-nav-count">
                      <span className="hm-sr-only">, </span>
                      {counts?.get(domain.id)}
                      <span className="hm-sr-only"> items</span>
                    </span>
                  ) : null}
                </Link>
              </li>
            ),
          )}
        </ul>
      </nav>
      <nav aria-label="Manage">
        <ul>
          <li>
            <Link
              href="/connect"
              className="hm-nav-item"
              aria-current={pathname.startsWith("/connect") ? "page" : undefined}
            >
              <Plug aria-hidden="true" size={18} strokeWidth={1.75} />
              <span className="hm-nav-label">Connect services</span>
            </Link>
          </li>
          <li>
            <Link
              href="/permissions"
              className="hm-nav-item"
              aria-current={pathname.startsWith("/permissions") ? "page" : undefined}
            >
              <ShieldCheck aria-hidden="true" size={18} strokeWidth={1.75} />
              <span className="hm-nav-label">Permissions</span>
            </Link>
          </li>
        </ul>
      </nav>
    </div>
  );
}
