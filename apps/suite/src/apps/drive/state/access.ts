// AUTHORED-BY Codex
"use client";

import { useEffect, useState } from "react";
import { loadSharing } from "../lib/sharing/apply";
import type { SharingState } from "../lib/sharing/types";
import { useDrive } from "./drive-context";
import { useResourceVersion } from "./resource";

/** One access summary for Details and copied-link confirmations. */
export function sharingSummary(state: SharingState, webId: string): string {
  if (state.link !== "none") return "Anyone with the link";
  const others = state.people.filter((person) => person.webId !== webId);
  if (others.length) return `People you've shared with: ${others.length}`;
  return state.people.length ? "Only you" : "No one";
}

/** Recheck effective access on selection or invalidation, hiding superseded results. */
export function useAccessLabel(url: string | undefined): string {
  const {
    session: { fetch: http, storageUrl, webId },
  } = useDrive();
  const version = useResourceVersion(url);
  const [result, setResult] = useState<{
    url: string;
    http: typeof http;
    storageUrl: string;
    webId: string;
    version: number;
    label: string;
  }>();
  useEffect(() => {
    if (!url) return;
    let live = true;
    void loadSharing({ fetch: http, storageUrl, webId }, url)
      .then(({ state }) => {
        if (live)
          setResult({
            url,
            http,
            storageUrl,
            webId,
            version,
            label: sharingSummary(state, webId),
          });
      })
      .catch(() => {
        if (live) setResult({ url, http, storageUrl, webId, version, label: "Access unknown" });
      });
    return () => {
      live = false;
    };
  }, [url, http, storageUrl, webId, version]);
  return result &&
    result.url === url &&
    result.http === http &&
    result.storageUrl === storageUrl &&
    result.webId === webId &&
    result.version === version
    ? result.label
    : "Access unknown";
}
