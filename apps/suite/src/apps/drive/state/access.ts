// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex
"use client";

import { useEffect, useState } from "react";
import { loadSharing, type SharingSnapshot } from "../lib/sharing/adapter";
import type { SharingState } from "../lib/sharing/types";
import { useDrive } from "./drive-context";
import { useResourceVersion } from "./resource";

/** One access summary for Details and copied-link confirmations. */
export function sharingSummary(state: SharingState, webId: string): string {
  if (state.link !== "none") return "Anyone with the link";
  if (state.groups?.length) return "Shared with groups";
  const others = state.people.filter((person) => person.webId !== webId);
  if (others.length) return `People you've shared with: ${others.length}`;
  return state.people.length ? "Only you" : "No one";
}
/** A folder whose contents are shared differently has no single summary; never imply privacy. */
export function accessSummary(
  snapshot: Pick<SharingSnapshot, "state" | "contentsDiffer">,
  webId: string,
): string {
  return snapshot.contentsDiffer ? "Access unknown" : sharingSummary(snapshot.state, webId);
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
      .then((snapshot) => {
        if (live)
          setResult({
            url,
            http,
            storageUrl,
            webId,
            version,
            label: accessSummary(snapshot, webId),
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
