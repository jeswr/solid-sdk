// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useRef, useState } from "react";

export interface SelectionOptions {
  selectedKeys?: ReadonlySet<string>;
  defaultSelectedKeys?: Iterable<string>;
  onSelectionChange?: (keys: ReadonlySet<string>) => void;
}

/** Stable IDs survive sorting and filtering. Bulk operations affect only the supplied IDs. */
export function useSelection(options: SelectionOptions = {}) {
  const [internal, setInternal] = useState(() => new Set(options.defaultSelectedKeys));
  const selectedKeys = options.selectedKeys ?? internal;
  const current = useRef(selectedKeys);
  current.current = selectedKeys;
  const anchor = useRef<string | null>(null);
  const rangeBase = useRef<ReadonlySet<string> | null>(null);

  function commit(keys: Set<string>) {
    current.current = keys;
    if (options.selectedKeys === undefined) setInternal(keys);
    options.onSelectionChange?.(keys);
  }

  function select(
    key: string,
    orderedKeys: readonly string[],
    modifiers: { range?: boolean; toggle?: boolean; additive?: boolean } = {},
    from?: string,
  ) {
    if (modifiers.range) {
      const start = orderedKeys.indexOf(anchor.current ?? from ?? key);
      const end = orderedKeys.indexOf(key);
      if (end < 0) return;
      anchor.current = start < 0 ? key : (anchor.current ?? from ?? key);
      rangeBase.current ??= new Set(current.current);
      const next = new Set(modifiers.additive ? rangeBase.current : []);
      for (const id of orderedKeys.slice(
        Math.min(start < 0 ? end : start, end),
        Math.max(start, end) + 1,
      ))
        next.add(id);
      commit(next);
      return;
    }
    anchor.current = key;
    rangeBase.current = null;
    const next = new Set(modifiers.toggle || modifiers.additive ? current.current : []);
    if (modifiers.toggle && next.has(key)) next.delete(key);
    else next.add(key);
    commit(next);
  }

  function toggleAll(keys: readonly string[]) {
    const next = new Set(current.current);
    const all = keys.length > 0 && keys.every((key) => next.has(key));
    for (const key of keys) {
      if (all) next.delete(key);
      else next.add(key);
    }
    rangeBase.current = null;
    commit(next);
  }

  return {
    selectedKeys,
    select,
    toggle: (key: string) => select(key, [], { toggle: true }),
    selectAll: (keys: readonly string[]) => {
      rangeBase.current = null;
      commit(new Set([...current.current, ...keys]));
    },
    toggleAll,
    clear: () => {
      anchor.current = null;
      rangeBase.current = null;
      commit(new Set());
    },
  };
}

export type SelectionModel = ReturnType<typeof useSelection>;
