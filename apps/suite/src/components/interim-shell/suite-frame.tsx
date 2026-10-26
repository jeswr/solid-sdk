// AUTHORED-BY Claude Opus 5.5
"use client";
/**
 * Interim suite frame for the Drive and Docs first cut: rail, top bar, app
 * sidebar, main and an optional details pane, following 02-suite-shell §2.
 * It stands in for DS-03/DS-04 (AppRail, TopBar, SidebarNav, DetailsPane) and
 * SH-01's `(suite)` layout; when those land, app layouts render their content
 * into the shell instead and this folder is deleted.
 */

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@jeswr/suite-ui";
import { FileText, HardDrive, Menu, Search } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";

export type SuiteAppId = "drive" | "docs";

const APPS: { id: SuiteAppId; label: string; href: string; icon: typeof HardDrive }[] = [
  { id: "drive", label: "Drive", href: "/drive", icon: HardDrive },
  { id: "docs", label: "Docs", href: "/docs", icon: FileText },
];

export interface SuiteFrameProps {
  app: SuiteAppId;
  /** The app's sidebar navigation (also the mobile drawer). */
  sidebar: ReactNode;
  /** Top bar context slot (breadcrumbs or title). */
  context?: ReactNode;
  /** Top bar trailing actions. */
  actions?: ReactNode;
  /** Search placeholder and target (`?q=` is appended). */
  search?: { placeholder: string; action: string; scopeLabel: string };
  /** Right-hand details pane (≥1024 only; apps show a sheet below that). */
  details?: ReactNode;
  children: ReactNode;
}

function Rail({ app }: { app: SuiteAppId }) {
  return (
    <nav className="ish-rail" aria-label="Apps">
      <Link href="/drive" className="ish-brand" aria-label="Solid Suite home">
        <svg viewBox="0 0 40 40" aria-hidden="true" width="32" height="32">
          <polygon points="20,4 34,12 34,28 20,36 6,28 6,12" />
        </svg>
      </Link>
      <ul>
        {APPS.map(({ id, label, href, icon: Icon }) => (
          <li key={id}>
            <Link
              href={href}
              className="ish-rail-item"
              aria-current={id === app ? "page" : undefined}
              title={label}
            >
              <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
              <span className="ish-rail-label">{label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function SearchBox({ search }: { search: NonNullable<SuiteFrameProps["search"]> }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  return (
    <search className="ish-search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const q = value.trim();
          if (q) router.push(`${search.action}?q=${encodeURIComponent(q)}`);
        }}
      >
        <Search aria-hidden="true" size={18} strokeWidth={1.75} />
        <span className="ish-scope">{search.scopeLabel}</span>
        <input
          type="search"
          aria-label={search.placeholder}
          placeholder={search.placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          data-global-search
        />
      </form>
    </search>
  );
}

export function SuiteFrame({
  app,
  sidebar,
  context,
  actions,
  search,
  details,
  children,
}: SuiteFrameProps) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  // Close the drawer on navigation; pathname is the trigger, not a value we read.
  // biome-ignore lint/correctness/useExhaustiveDependencies: pathname change is the event
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (event.key === "/" && !event.metaKey && !event.ctrlKey) {
        const input = document.querySelector<HTMLInputElement>("[data-global-search]");
        if (input) {
          event.preventDefault();
          input.focus();
        }
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  return (
    <div className="ish-frame" data-app={app} data-has-details={details ? "" : undefined}>
      <Rail app={app} />
      <aside
        className="ish-sidebar"
        aria-label={`${APPS.find((a) => a.id === app)?.label} navigation`}
      >
        {sidebar}
      </aside>
      <Sheet open={drawer} onOpenChange={setDrawer}>
        <SheetContent side="left" className="ish-drawer">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">App navigation</SheetDescription>
          {sidebar}
        </SheetContent>
      </Sheet>
      <header className="ish-topbar">
        <button
          type="button"
          className="ish-menu-button"
          aria-label="Open navigation"
          onClick={() => setDrawer(true)}
        >
          <Menu aria-hidden="true" size={20} strokeWidth={1.75} />
        </button>
        <div className="ish-context">{context}</div>
        {search ? <SearchBox search={search} /> : <div className="ish-spacer" />}
        <div className="ish-actions">{actions}</div>
      </header>
      <main id="main-content" className="ish-main" tabIndex={-1}>
        {children}
      </main>
      {details ? (
        <aside className="ish-details" aria-label="Details">
          {details}
        </aside>
      ) : null}
      <nav className="ish-tabbar" aria-label="Apps">
        {APPS.map(({ id, label, href, icon: Icon }) => (
          <Link key={id} href={href} aria-current={id === app ? "page" : undefined}>
            <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}
