// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
"use client";

import { defaultRangeExtractor } from "@tanstack/react-virtual";
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from "react";
import type { SelectionModel } from "./use-selection.js";

// Widget roles own their activation even when they are not natively focusable.
const WIDGET_ROLES = [
  "button",
  "link",
  "checkbox",
  "radio",
  "switch",
  "tab",
  "option",
  "listbox",
  "combobox",
  "textbox",
  "searchbox",
  "slider",
  "spinbutton",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "treeitem",
];
const INTERACTIVE = [
  "button, a, input, label, select, textarea, summary, [contenteditable]",
  "[data-row-interactive], [tabindex]",
  ...WIDGET_ROLES.map((role) => `[role="${role}"]`),
].join(", ");

/** Descendant controls own their activation; clicks on the row itself still select it. */
export function isInteractiveDescendant(event: {
  target: EventTarget;
  currentTarget: HTMLElement;
}) {
  const control = event.target instanceof Element ? event.target.closest(INTERACTIVE) : null;
  return control !== null && control !== event.currentTarget;
}

/** Read actual inherited density tokens; observe ancestor overrides, resizing and touch changes. */
export function useCollectionMetrics(kind: "table" | "grid") {
  const viewport = useRef<HTMLDivElement>(null);
  const [metrics, setMetrics] = useState({
    height: kind === "table" ? 44 : 200,
    width: 0,
    headerHeight: 36,
  });
  useLayoutEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const update = () => {
      const style = getComputedStyle(element);
      const height =
        Number.parseFloat(
          style.getPropertyValue(kind === "table" ? "--row-h" : "--row-h-grid-card"),
        ) || (kind === "table" ? 44 : 200);
      const width = element.clientWidth;
      const headerHeight =
        Number.parseFloat(style.getPropertyValue("--suite-table-header-h")) || 36;
      setMetrics((previous) =>
        previous.height === height &&
        previous.width === width &&
        previous.headerHeight === headerHeight
          ? previous
          : { height, width, headerHeight },
      );
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(element);
    const mutations = new MutationObserver(update);
    for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) {
      mutations.observe(ancestor, {
        attributes: true,
        attributeFilter: ["data-density", "class", "style"],
      });
    }
    const coarse = matchMedia("(pointer: coarse)");
    coarse.addEventListener("change", update);
    return () => {
      resize.disconnect();
      mutations.disconnect();
      coarse.removeEventListener("change", update);
    };
  }, [kind]);
  return { viewport, ...metrics };
}

export function useCollectionNavigation({
  keys,
  selection,
  columns = 1,
  scrollToIndex,
  onOpen,
  onDetails,
}: {
  keys: readonly string[];
  selection: SelectionModel;
  columns?: number;
  scrollToIndex: (index: number) => void;
  onOpen: (key: string) => void;
  onDetails?: ((key: string) => void) | undefined;
}) {
  const [storedKey, setKey] = useState<string | undefined>(keys[0]);
  const activeKey = storedKey !== undefined && keys.includes(storedKey) ? storedKey : keys[0];
  const activeIndex = activeKey === undefined ? -1 : keys.indexOf(activeKey);
  const collection = useRef<HTMLDivElement>(null);
  const elements = useRef(new Map<string, HTMLElement>());
  const pendingFocus = useRef<string | null>(null);
  const hadFocus = useRef(false);

  // Restore focus when filtering/removal or responsive card reparenting unmounts its DOM node.
  useLayoutEffect(() => {
    if (!hadFocus.current) return;
    if (
      document.activeElement !== document.body &&
      !collection.current?.contains(document.activeElement)
    ) {
      hadFocus.current = false;
      return;
    }
    if (activeKey === undefined || columns < 1) return;
    if (activeKey !== storedKey) {
      scrollToIndex(0);
      elements.current.get(activeKey)?.focus({ preventScroll: true });
    } else if (document.activeElement === document.body) {
      elements.current.get(activeKey)?.focus({ preventScroll: true });
    }
  }, [activeKey, storedKey, columns, scrollToIndex]);

  function focus(index: number) {
    const key = keys[Math.max(0, Math.min(keys.length - 1, index))];
    if (key === undefined) return;
    pendingFocus.current = key;
    setKey(key);
    scrollToIndex(Math.floor(keys.indexOf(key) / columns));
    const element = elements.current.get(key);
    if (element) {
      element.focus({ preventScroll: true });
      pendingFocus.current = null;
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>, key: string) {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (isInteractiveDescendant(event) && !target.matches(".suite-selection-checkbox")) return;
    const index = keys.indexOf(key);
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
      event.preventDefault();
      selection.selectAll(keys);
      return;
    }
    if (event.ctrlKey || event.metaKey || (event.altKey && event.key !== "Enter")) return;
    const delta =
      event.key === "ArrowDown"
        ? columns
        : event.key === "ArrowUp"
          ? -columns
          : event.key.toLowerCase() === "j" || event.key === "ArrowRight"
            ? 1
            : event.key.toLowerCase() === "k" || event.key === "ArrowLeft"
              ? -1
              : 0;
    if (delta || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? keys.length - 1
            : Math.max(0, Math.min(keys.length - 1, index + delta));
      const nextKey = keys[next];
      if (event.shiftKey && nextKey !== undefined)
        selection.select(nextKey, keys, { range: true }, key);
      focus(next);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      selection.select(key, keys, { toggle: true, range: event.shiftKey });
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (event.altKey) onDetails?.(key);
      else onOpen(key);
    } else if (event.key === "Escape") {
      event.preventDefault();
      selection.clear();
    }
  }

  return {
    collection,
    activeKey,
    // Keep the focused item mounted when a pointer scroll moves it outside the viewport.
    rangeExtractor: (range: Parameters<typeof defaultRangeExtractor>[0]) => {
      const indexes = defaultRangeExtractor(range);
      const index = Math.floor(activeIndex / columns);
      if (index >= 0 && index < range.count && !indexes.includes(index)) indexes.push(index);
      return indexes.sort((a, b) => a - b);
    },
    itemProps: (key: string) => ({
      tabIndex: key === activeKey ? 0 : -1,
      ref: (element: HTMLElement | null) => {
        if (!element) {
          elements.current.delete(key);
          return;
        }
        elements.current.set(key, element);
        if (pendingFocus.current === key) {
          element.focus({ preventScroll: true });
          pendingFocus.current = null;
        }
      },
      onFocus: () => {
        hadFocus.current = true;
        setKey(key);
      },
      onBlur: (event: React.FocusEvent<HTMLElement>) => {
        if (
          !event.relatedTarget ||
          !(event.relatedTarget as HTMLElement).closest("[data-collection-item]")
        )
          hadFocus.current = false;
      },
      onKeyDown: (event: KeyboardEvent<HTMLElement>) => onKeyDown(event, key),
    }),
  };
}
