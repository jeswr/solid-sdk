// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { type ReactNode, useEffect, useId, useRef, useSyncExternalStore } from "react";
import { DetailsPane, type DetailsPaneProps } from "./details-pane.js";
import { SidebarNav, type SidebarNavProps } from "./navigation.js";
import { isShellShortcut, type ShellPreferences, shellDocumentTitle } from "./preferences.js";
import { ShellSheet } from "./sheet.js";
import { TopBar, type TopBarProps } from "./top-bar.js";

const desktopQuery = "(min-width: 1024px)";
const subscribe = (listener: () => void) => {
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
};
const desktopSnapshot = () => window.matchMedia(desktopQuery).matches;
const serverSnapshot = () => false;

export interface ShellFrameProps {
  pageTitle: string;
  topBar: Omit<TopBarProps, "sidebarToggle" | "detailsToggle">;
  sidebar: SidebarNavProps;
  details?: Omit<DetailsPaneProps, "onClose">;
  /** Supply AppRail / BottomTabBar; their app registration belongs to the shell app. */
  rail: ReactNode;
  tabBar: ReactNode;
  preferences: ShellPreferences;
  onPreferencesChange: (value: ShellPreferences) => void;
  children: ReactNode;
  /** Root layouts may supply the suite-wide skip link instead. */
  skipLink?: boolean;
}

/** Owns the page's one h1, main scroll container, landmarks and responsive overlays. */
export function ShellFrame({
  pageTitle,
  topBar,
  sidebar,
  details,
  rail,
  tabBar,
  preferences,
  onPreferencesChange,
  children,
  skipLink = true,
}: ShellFrameProps) {
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
  const frame = useRef<HTMLDivElement>(null);
  const sidebarId = useId();
  const detailsId = useId();
  const sidebarOpen = preferences.sidebarOpen ?? desktop;
  const detailsOpen = Boolean(details) && (preferences.detailsOpen ?? desktop);
  const setSidebar = (open: boolean) => onPreferencesChange({ ...preferences, sidebarOpen: open });
  const setDetails = (open: boolean) => onPreferencesChange({ ...preferences, detailsOpen: open });
  const restoreFocus = (label: string) =>
    frame.current?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.focus();

  useEffect(() => {
    document.title = shellDocumentTitle(pageTitle, topBar.appName);
  }, [pageTitle, topBar.appName]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!isShellShortcut(event, event.target)) return;
      // Other dialogs/editors own their keyboard paths; only our shell sheets opt in.
      const dialog =
        event.target instanceof Element ? event.target.closest('[role="dialog"]') : null;
      if (dialog && dialog.id !== sidebarId && dialog.id !== detailsId) return;
      event.preventDefault();
      if (event.key === "[") {
        onPreferencesChange({
          ...preferences,
          sidebarOpen: !sidebarOpen,
          ...(!desktop && !sidebarOpen ? { detailsOpen: false } : {}),
        });
      } else if (details) {
        if (!desktop && sidebarOpen) {
          onPreferencesChange({ ...preferences, sidebarOpen: false, detailsOpen: !detailsOpen });
        } else setDetails(!detailsOpen);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const toggleSidebar = () =>
    onPreferencesChange({
      ...preferences,
      sidebarOpen: !sidebarOpen,
      ...(!desktop && !sidebarOpen ? { detailsOpen: false } : {}),
    });
  const toggleDetails = () =>
    onPreferencesChange({
      ...preferences,
      detailsOpen: !detailsOpen,
      ...(!desktop && !detailsOpen ? { sidebarOpen: false } : {}),
    });

  return (
    <div
      ref={frame}
      className="suite-shell"
      data-sidebar-open={desktop && sidebarOpen}
      data-details-open={desktop && detailsOpen}
    >
      {skipLink && (
        <a className="suite-skip-link" href="#main-content">
          Skip to main content
        </a>
      )}
      <div className="suite-rail-slot">{rail}</div>
      <div
        id={desktop ? sidebarId : undefined}
        className="suite-sidebar-slot"
        hidden={!desktop || !sidebarOpen}
      >
        <SidebarNav {...sidebar} />
      </div>
      <TopBar
        {...topBar}
        sidebarToggle={{ open: sidebarOpen, controls: sidebarId, onToggle: toggleSidebar }}
        {...(details
          ? { detailsToggle: { open: detailsOpen, controls: detailsId, onToggle: toggleDetails } }
          : {})}
      />
      <main
        id="main-content"
        tabIndex={-1}
        className="suite-main"
        aria-labelledby="suite-page-title"
      >
        <h1 id="suite-page-title">{pageTitle}</h1>
        {children}
      </main>
      <div
        id={desktop ? detailsId : undefined}
        className="suite-details-slot"
        hidden={!desktop || !detailsOpen}
      >
        {details && (
          <DetailsPane
            {...details}
            onClose={() => {
              setDetails(false);
              restoreFocus("Toggle details pane");
            }}
          />
        )}
      </div>
      <div className="suite-tabbar-slot">{tabBar}</div>
      {!desktop && (
        <>
          <ShellSheet
            id={sidebarId}
            open={sidebarOpen}
            onOpenChange={setSidebar}
            side="left"
            title={sidebar.label}
            restoreFocus={() => restoreFocus("Toggle sidebar")}
          >
            <SidebarNav
              {...sidebar}
              onNavigate={() => {
                sidebar.onNavigate?.();
                setSidebar(false);
              }}
            />
          </ShellSheet>
          {details && (
            <ShellSheet
              id={detailsId}
              open={detailsOpen && !sidebarOpen}
              onOpenChange={setDetails}
              side="right"
              title="Details"
              restoreFocus={() => restoreFocus("Toggle details pane")}
            >
              <DetailsPane {...details} />
            </ShellSheet>
          )}
        </>
      )}
    </div>
  );
}
