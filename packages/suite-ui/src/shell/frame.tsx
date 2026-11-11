// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
} from "react";
import { DetailsPane, type DetailsPaneProps } from "./details-pane.js";
import { SidebarNav, type SidebarNavProps } from "./navigation.js";
import {
  isShellShortcut,
  type ShellPreferences,
  shellDocumentTitle,
  shouldClosePaneOnEscape,
} from "./preferences.js";
import { ShellSheet } from "./sheet.js";
import { TopBar, type TopBarProps } from "./top-bar.js";

const desktopQuery = "(min-width: 1024px)";
const desktopSnapshot = () => window.matchMedia(desktopQuery).matches;
const serverSnapshot = () => false;

export interface ShellFrameProps {
  pageTitle: string;
  topBar: Omit<TopBarProps, "sidebarToggle" | "detailsToggle">;
  sidebar: SidebarNavProps;
  details?: Omit<DetailsPaneProps, "onClose"> & {
    /** Controlled visibility; when omitted, the shell preference owns visibility. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
  };
  /** Supply AppRail / BottomTabBar; their app registration belongs to the shell app. */
  rail: ReactNode;
  tabBar: ReactNode;
  preferences: ShellPreferences;
  onPreferencesChange: (value: ShellPreferences) => void;
  children: ReactNode;
  /** Root layouts may supply the suite-wide skip link instead. */
  skipLink?: boolean;
  /**
   * Single-character `[` / `]` pane shortcuts (WCAG 2.1.4). Hosts with a "turn off
   * single-key shortcuts" setting pass false; the toggle buttons stay. Default true.
   */
  characterShortcuts?: boolean;
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
  characterShortcuts = true,
}: ShellFrameProps) {
  const frame = useRef<HTMLDivElement>(null);
  const sidebarRegion = useRef<HTMLDivElement>(null);
  const detailsRegion = useRef<HTMLDivElement>(null);
  const breakpointFocus = useRef<string | null>(null);
  const subscribe = useCallback((listener: () => void) => {
    const media = window.matchMedia(desktopQuery);
    const onChange = () => {
      // Capture focus before React removes the desktop content on a narrow viewport.
      breakpointFocus.current = !desktopSnapshot()
        ? sidebarRegion.current?.contains(document.activeElement)
          ? "Toggle sidebar"
          : detailsRegion.current?.contains(document.activeElement)
            ? "Toggle details pane"
            : null
        : null;
      listener();
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  const desktop = useSyncExternalStore(subscribe, desktopSnapshot, serverSnapshot);
  const sidebarId = useId();
  const detailsId = useId();
  const sidebarOpen = preferences.sidebarOpen ?? desktop;
  const detailsOpen = Boolean(details) && (details?.open ?? preferences.detailsOpen ?? desktop);
  // Below 1024px the regions are modal sheets, so at most one can be active. Saved
  // preferences may still say both are open (chosen on a wide viewport); the
  // sidebar wins unless the app explicitly opens controlled details. Narrow-viewport
  // changes keep the app's controlled state and the effective sheet in sync.
  const narrowSheet: "sidebar" | "details" | null = desktop
    ? null
    : details?.open && detailsOpen
      ? "details"
      : sidebarOpen
        ? "sidebar"
        : detailsOpen
          ? "details"
          : null;
  const sidebarExpanded = desktop ? sidebarOpen : narrowSheet === "sidebar";
  const detailsExpanded = desktop ? detailsOpen : narrowSheet === "details";
  const setSidebar = (open: boolean) => {
    if (!desktop && detailsOpen) details?.onOpenChange?.(false);
    onPreferencesChange({
      ...preferences,
      sidebarOpen: open,
      ...(!desktop && detailsOpen && details?.open === undefined ? { detailsOpen: false } : {}),
    });
  };
  const setDetails = (open: boolean) => {
    details?.onOpenChange?.(open);
    onPreferencesChange({
      ...preferences,
      ...(details?.open === undefined ? { detailsOpen: open } : {}),
      ...(!desktop && sidebarOpen ? { sidebarOpen: false } : {}),
    });
  };
  const toggleSidebar = () => setSidebar(!sidebarExpanded);
  const toggleDetails = () => setDetails(!detailsExpanded);
  const restoreFocus = useCallback(
    (label: string) =>
      frame.current?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)?.focus(),
    [],
  );

  useLayoutEffect(() => {
    const previousFocus = breakpointFocus.current;
    breakpointFocus.current = null;
    // Open sheets let Radix manage focus; default regions close at the breakpoint.
    if (!desktop) {
      if (previousFocus && narrowSheet === null) restoreFocus(previousFocus);
      return;
    }
    if (!sidebarOpen && sidebarRegion.current?.contains(document.activeElement))
      restoreFocus("Toggle sidebar");
    if (!detailsOpen && detailsRegion.current?.contains(document.activeElement))
      restoreFocus("Toggle details pane");
  }, [desktop, sidebarOpen, detailsOpen, narrowSheet, restoreFocus]);

  useEffect(() => {
    document.title = shellDocumentTitle(pageTitle, topBar.appName);
  }, [pageTitle, topBar.appName]);

  useEffect(() => {
    if (!characterShortcuts) return;
    const onKey = (event: KeyboardEvent) => {
      if (!isShellShortcut(event, event.target)) return;
      // Other dialogs/editors own their keyboard paths; only our shell sheets opt in.
      const dialog =
        event.target instanceof Element
          ? event.target.closest('dialog, [role="dialog"], [role="alertdialog"]')
          : null;
      if (dialog && dialog.id !== sidebarId && dialog.id !== detailsId) return;
      event.preventDefault();
      if (event.key === "[") toggleSidebar();
      else if (details) toggleDetails();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
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
        ref={sidebarRegion}
        id={desktop ? sidebarId : undefined}
        className="suite-sidebar-slot"
        hidden={!desktop || !sidebarOpen}
      >
        {desktop && <SidebarNav {...sidebar} />}
      </div>
      <TopBar
        {...topBar}
        sidebarToggle={{
          open: sidebarExpanded,
          controls: sidebarId,
          onToggle: toggleSidebar,
          keyShortcut: characterShortcuts,
        }}
        {...(details
          ? {
              detailsToggle: {
                open: detailsExpanded,
                controls: detailsId,
                onToggle: toggleDetails,
                keyShortcut: characterShortcuts,
              },
            }
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
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Escape bubbles from the pane's own controls. */}
      <div
        ref={detailsRegion}
        id={desktop ? detailsId : undefined}
        className="suite-details-slot"
        hidden={!desktop || !detailsOpen}
        onKeyDown={(event) => {
          // On wide viewports the pane is not a dialog, so Escape (01-§6 "close pane")
          // is handled here. Nested layers (Radix menus/dialogs) and editors consume it first.
          if (!desktop || !shouldClosePaneOnEscape(event.nativeEvent, event.target)) return;
          event.preventDefault();
          setDetails(false);
          restoreFocus("Toggle details pane");
        }}
      >
        {desktop && details && (
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
            open={narrowSheet === "sidebar"}
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
              open={narrowSheet === "details"}
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
