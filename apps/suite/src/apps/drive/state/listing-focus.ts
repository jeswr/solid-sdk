// AUTHORED-BY Codex
"use client";

import { type FocusEvent, type RefObject, useLayoutEffect, useRef, useState } from "react";
import { captureDriveFocusRemoval } from "./ui";

type FocusRecovery = {
  candidates: readonly string[];
  restore: ReturnType<typeof captureDriveFocusRemoval>;
};

function removalCandidates(ids: readonly string[], removed: ReadonlySet<string>) {
  const index = ids.findIndex((url) => removed.has(url));
  return [...ids.slice(index), ...ids.slice(0, index).reverse()].filter((url) => !removed.has(url));
}

/** Recover disconnected row/selection controls for local actions and live updates alike. */
export function useDriveListingFocus(
  ids: readonly string[],
  listing: RefObject<HTMLDivElement | null>,
) {
  const focused = useRef<(FocusRecovery & { element: HTMLElement; url: string }) | undefined>(
    undefined,
  );
  const [removal, setRemoval] = useState<FocusRecovery & { removed: ReadonlySet<string> }>();

  // Check the actual element after every commit: a control can disappear even when
  // its row survives. A surviving control elsewhere keeps focus through the shared helper.
  useLayoutEffect(() => {
    const recover = (focus: FocusRecovery) => {
      const next = focus.candidates.find((url) => ids.includes(url));
      focus.restore(next ?? ids[0], undefined, listing.current);
    };
    if (removal && !ids.some((url) => removal.removed.has(url))) {
      setRemoval(undefined);
      recover(removal);
    }
    const previous = focused.current;
    if (!previous) return;
    if (!previous.element.isConnected) {
      focused.current = undefined;
      recover(previous);
    } else if (ids.includes(previous.url)) {
      // Sorting, inserting or removing other rows can change the nearest neighbour.
      previous.candidates = [previous.url, ...removalCandidates(ids, new Set([previous.url]))];
    }
  });

  const onFocusCapture = (event: FocusEvent<HTMLElement>, selectedUrl?: string) => {
    const element = event.target as HTMLElement;
    const row = element.closest<HTMLElement>("[data-url], [data-drive-row]");
    const url = selectedUrl ?? row?.dataset.url ?? row?.dataset.driveRow;
    focused.current = url
      ? {
          element,
          url,
          candidates: [url, ...removalCandidates(ids, new Set([url]))],
          restore: captureDriveFocusRemoval(),
        }
      : undefined;
  };
  const onBlurCapture = (event: FocusEvent<HTMLElement>) => {
    if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
      focused.current = undefined;
  };
  const focusAfterRemoval = (removedUrls: readonly string[]) => {
    const removed = new Set(removedUrls);
    if (removed.size === 0) return;
    setRemoval({
      removed,
      candidates: removalCandidates(ids, removed),
      restore: captureDriveFocusRemoval(),
    });
  };
  return { onFocusCapture, onBlurCapture, focusAfterRemoval };
}
