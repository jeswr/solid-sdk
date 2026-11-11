// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Codex
"use client";
/**
 * Interim suite frame for the Drive and Docs first cut: rail, top bar, app
 * sidebar, main and an optional details pane, following 02-suite-shell §2.
 * It stands in for DS-03/DS-04 (AppRail, TopBar, SidebarNav, DetailsPane) and
 * SH-01's `(suite)` layout; when those land, app layouts render their content
 * into the shell instead and this folder is deleted.
 */

import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@jeswr/suite-ui";
import {
  Bot,
  CalendarDays,
  FileText,
  HardDrive,
  HeartPulse,
  House,
  Images,
  Mail,
  Menu,
  MessageSquare,
  Music,
  Search,
  SquareCheckBig,
  StickyNote,
  Table2,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";
import { WalkthroughDock } from "@/welcome/walkthrough";

export type SuiteAppId =
  | "home"
  | "drive"
  | "docs"
  | "calendar"
  | "contacts"
  | "photos"
  | "mail"
  | "chat"
  | "money"
  | "health"
  | "tasks"
  | "music"
  | "notes"
  | "sheets"
  | "agent";

const APPS: { id: SuiteAppId; label: string; href: string; icon: typeof HardDrive }[] = [
  { id: "home", label: "Home", href: "/home", icon: House },
  { id: "drive", label: "Drive", href: "/drive", icon: HardDrive },
  { id: "calendar", label: "Calendar", href: "/calendar", icon: CalendarDays },
  { id: "docs", label: "Docs", href: "/docs", icon: FileText },
  { id: "sheets", label: "Sheets", href: "/sheets", icon: Table2 },
  { id: "notes", label: "Notes", href: "/notes", icon: StickyNote },
  { id: "contacts", label: "Contacts", href: "/contacts", icon: Users },
  { id: "photos", label: "Photos", href: "/photos", icon: Images },
  { id: "mail", label: "Mail", href: "/mail", icon: Mail },
  { id: "chat", label: "Chat", href: "/chat", icon: MessageSquare },
  { id: "money", label: "Money", href: "/money", icon: Wallet },
  { id: "health", label: "Health", href: "/health", icon: HeartPulse },
  { id: "tasks", label: "Tasks", href: "/tasks", icon: SquareCheckBig },
  { id: "music", label: "Music", href: "/music", icon: Music },
  { id: "agent", label: "Agent", href: "/agent", icon: Bot },
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
  search?: { placeholder: string; action: string; scopeLabel: string; query?: string };
  /** Details shown in a pane at ≥1024px and a modal Sheet below that. */
  details?: ReactNode;
  onDetailsClose?: () => void;
  detailsReturnFocus?: RefObject<HTMLElement | null>;
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

export function SearchBox({ search }: { search: NonNullable<SuiteFrameProps["search"]> }) {
  const router = useRouter();
  const [value, setValue] = useState(search.query ?? "");
  useEffect(() => setValue(search.query ?? ""), [search.query]);
  return (
    <search className="ish-search">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const q = value.trim();
          router.push(q ? `${search.action}?q=${encodeURIComponent(q)}` : search.action);
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
  onDetailsClose,
  detailsReturnFocus,
  children,
}: SuiteFrameProps) {
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);
  const [detailsSide, setDetailsSide] = useState<"bottom" | "right" | "pane">("pane");
  const navigationTrigger = useRef<HTMLButtonElement>(null);
  const detailsTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const narrow = window.matchMedia("(max-width: 1023px)");
    const phone = window.matchMedia("(max-width: 639px)");
    const update = () =>
      setDetailsSide(narrow.matches ? (phone.matches ? "bottom" : "right") : "pane");
    update();
    narrow.addEventListener("change", update);
    phone.addEventListener("change", update);
    return () => {
      narrow.removeEventListener("change", update);
      phone.removeEventListener("change", update);
    };
  }, []);
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
        <SheetContent
          side="left"
          className="ish-drawer"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            navigationTrigger.current?.focus();
          }}
        >
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">App navigation</SheetDescription>
          {sidebar}
        </SheetContent>
      </Sheet>
      <header className="ish-topbar">
        <button
          type="button"
          className="ish-menu-button"
          ref={navigationTrigger}
          aria-label="Open navigation"
          onClick={() => setDrawer(true)}
        >
          <Menu aria-hidden="true" size={20} strokeWidth={1.75} />
        </button>
        <div className="ish-context">{context}</div>
        {search ? <SearchBox search={search} /> : <div className="ish-spacer" />}
        <div className="ish-actions">
          {actions}
          <Link className="suite-feedback-link" href="/feedback">
            Give feedback
          </Link>
        </div>
      </header>
      <main id="main-content" className="ish-main" tabIndex={-1}>
        {children}
      </main>
      {details && detailsSide === "pane" ? (
        <aside className="ish-details" aria-label="Details">
          {details}
        </aside>
      ) : null}
      {detailsSide !== "pane" ? (
        <Sheet open={Boolean(details)} onOpenChange={(open) => !open && onDetailsClose?.()}>
          <SheetContent
            side={detailsSide}
            className="ish-details-sheet"
            showCloseButton={false}
            onOpenAutoFocus={() => {
              detailsTrigger.current =
                document.activeElement instanceof HTMLElement ? document.activeElement : null;
            }}
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const trigger = detailsReturnFocus?.current ?? detailsTrigger.current;
              (trigger?.isConnected ? trigger : document.getElementById("main-content"))?.focus();
            }}
          >
            <SheetTitle className="sr-only">Details</SheetTitle>
            <SheetDescription className="sr-only">Details of the selected items</SheetDescription>
            {details}
          </SheetContent>
        </Sheet>
      ) : null}
      <nav className="ish-tabbar" aria-label="Apps">
        {APPS.map(({ id, label, href, icon: Icon }) => (
          <Link key={id} href={href} aria-current={id === app ? "page" : undefined}>
            <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
            <span>{label}</span>
          </Link>
        ))}
      </nav>
      <WalkthroughDock />
    </div>
  );
}
