// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
"use client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { selectionReducer } from "./selection";

interface ListFocus {
  activeUrl: string | undefined;
  onFocus: (url: string) => void;
  onMove: (url: string, direction: -1 | 1) => void;
  refresh: () => void;
  selection: ReadonlySet<string>;
  selectedUrls: () => ReadonlySet<string>;
  toggleSelection: (url: string) => void;
  clearSelection: () => void;
  /** Cmd/Ctrl+A: select every visible row. */
  selectAll: () => void;
  /** Shift+↑/↓ and Shift+click: select from the range anchor through `to`, then focus it. */
  selectRange: (from: string, to: string) => void;
  /** Shift+↑/↓ from a focused row. */
  extendSelection: (url: string, direction: -1 | 1) => void;
  announce: (message: string) => void;
}
const POPUP = '[role="menu"], [role="alertdialog"], [role="dialog"]';
const ListFocusContext = createContext<ListFocus | undefined>(undefined);
export const useTaskListFocus = () => useContext(ListFocusContext);

/** Own one cursor in a persistent parent, across sections and smart-view groups alike. */
export function TaskListFocus({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const [activeUrl, setActive] = useState<string>();
  const [selection, dispatch] = useReducer(selectionReducer, new Set<string>());
  const [announcement, announce] = useState("");
  const anchor = useRef<{ url: string; base: string[] } | undefined>(undefined);
  const focused = useRef<{ element: HTMLElement; url: string; order: string[] } | undefined>(
    undefined,
  );
  const popupFrame = useRef(0);
  // DOM order includes nesting and omits collapsed groups, matching what the user can reach.
  const visibleRows = () =>
    [...(root.current?.querySelectorAll<HTMLElement>("[data-tsk-row]") ?? [])].filter(
      (row) => !row.closest("[hidden]"),
    );
  const refresh = () => {
    const rows = visibleRows();
    const urls = rows.map((row) => row.dataset.tskRow as string);
    dispatch({ type: "prune", visible: urls });
    setActive((active) => (active && urls.includes(active) ? active : urls[0]));
    const previous = focused.current;
    if (!previous) return;
    if (previous.element.isConnected && urls.includes(previous.url)) {
      previous.order = urls;
      return;
    }
    focused.current = undefined;
    const current = document.activeElement;
    if (current instanceof HTMLElement && current !== document.body && current.isConnected) {
      // A menu or dialog opened from the removed row still holds focus: hand focus off once it
      // has closed and the page is no longer inert, unless focus has landed elsewhere by then.
      if (!root.current?.contains(current) && current.closest(POPUP)) awaitPopup(previous);
      return;
    }
    // A closing popup may still hold the page inert, where focus() silently fails.
    if (inert()) awaitPopup(previous);
    else handOff(previous);
  };
  // Radix marks nodes inside the list inert too, not only its ancestors.
  const inert = () =>
    Boolean(root.current?.closest("[inert]") ?? root.current?.querySelector("[inert]"));
  const handOff = (previous: { url: string; order: string[] }) => {
    const rows = visibleRows();
    const urls = rows.map((row) => row.dataset.tskRow as string);
    const index = previous.order.indexOf(previous.url);
    const next =
      [
        previous.url,
        ...previous.order.slice(index + 1),
        ...previous.order.slice(0, index).reverse(),
      ].find((url) => urls.includes(url)) ?? urls[0];
    if (next) rows.find((row) => row.dataset.tskRow === next)?.focus();
    else {
      const content = root.current?.closest(".tsk-content");
      const add = [
        ...(root.current?.querySelectorAll<HTMLElement>(
          "[data-tsk-add] button, [data-tsk-add] input",
        ) ?? []),
      ].find((element) => !element.closest("[hidden]"));
      const fallback =
        content?.querySelector<HTMLElement>(".tsk-empty-add") ??
        add ??
        content?.querySelector<HTMLElement>("h1") ??
        document.querySelector<HTMLElement>(".tsk-primary-add");
      fallback?.focus();
    }
  };
  const awaitPopup = (previous: { url: string; order: string[] }) => {
    cancelAnimationFrame(popupFrame.current);
    const tick = () => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active !== document.body && active.isConnected) {
        if (active.closest(POPUP)) popupFrame.current = requestAnimationFrame(tick);
        return;
      }
      if (inert()) popupFrame.current = requestAnimationFrame(tick);
      else handOff(previous);
    };
    popupFrame.current = requestAnimationFrame(tick);
  };
  useEffect(() => () => cancelAnimationFrame(popupFrame.current), []);
  useLayoutEffect(refresh);
  const selectRange = (from: string, to: string) => {
    const rows = visibleRows();
    const urls = rows.map((row) => row.dataset.tskRow as string);
    if (!anchor.current || !urls.includes(anchor.current.url))
      anchor.current = { url: from, base: [...selection].filter((url) => url !== from) };
    const next = selectionReducer(selection, {
      type: "range",
      base: anchor.current.base,
      visible: urls,
      anchor: anchor.current.url,
      to,
    });
    dispatch({
      type: "range",
      base: anchor.current.base,
      visible: urls,
      anchor: anchor.current.url,
      to,
    });
    rows.find((row) => row.dataset.tskRow === to)?.focus();
    announce(`${next.size} selected`);
  };
  return (
    <ListFocusContext.Provider
      value={{
        activeUrl,
        refresh,
        selection,
        selectedUrls: () =>
          new Set(
            visibleRows()
              .map((row) => row.dataset.tskRow as string)
              .filter((url) => selection.has(url)),
          ),
        toggleSelection: (url) => {
          // The toggled row anchors a later Shift+↑/↓ or Shift+click range.
          anchor.current = { url, base: [...selection].filter((item) => item !== url) };
          dispatch({ type: "toggle", url });
        },
        clearSelection: () => {
          anchor.current = undefined;
          dispatch({ type: "clear" });
        },
        selectAll: () => {
          const urls = visibleRows().map((row) => row.dataset.tskRow as string);
          dispatch({ type: "add", urls });
          announce(`Selected ${urls.length} ${urls.length === 1 ? "task" : "tasks"}`);
        },
        selectRange,
        extendSelection: (url, direction) => {
          const urls = visibleRows().map((row) => row.dataset.tskRow as string);
          const to = urls[urls.indexOf(url) + direction];
          if (to) selectRange(url, to);
        },
        announce,
        onFocus: setActive,
        onMove: (url, direction) => {
          const rows = visibleRows();
          const index = rows.findIndex((row) => row.dataset.tskRow === url);
          rows[Math.max(0, Math.min(rows.length - 1, index + direction))]?.focus();
        },
      }}
    >
      <div
        ref={root}
        className={className}
        onFocusCapture={(event) => {
          const element = event.target as HTMLElement;
          const row = element.closest<HTMLElement>("[data-tsk-row]");
          if (row?.dataset.tskRow)
            focused.current = {
              element,
              url: row.dataset.tskRow,
              order: visibleRows().map((row) => row.dataset.tskRow as string),
            };
          else if (event.currentTarget.contains(element)) focused.current = undefined;
        }}
        onBlurCapture={(event) => {
          const next = event.relatedTarget;
          if (
            next instanceof HTMLElement &&
            next !== document.body &&
            !event.currentTarget.contains(next) &&
            !next.closest(POPUP)
          )
            focused.current = undefined;
        }}
      >
        {children}
        <span className="suite-sr-only" role="status" aria-live="polite" aria-atomic="true">
          {announcement}
        </span>
      </div>
    </ListFocusContext.Provider>
  );
}
