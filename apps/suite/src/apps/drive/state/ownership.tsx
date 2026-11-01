// AUTHORED-BY Codex
"use client";
import { useEffect, useState } from "react";
import { type ItemOwner, isOwnStorage, resolveItemOwner } from "../lib/client/ownership";
import { useDrive } from "./drive-context";

export function useItemOwner(url: string | undefined): ItemOwner | undefined {
  const {
    session: { storageUrl, webId, fetch: http },
  } = useDrive();
  const [result, setResult] = useState<{
    url: string;
    storageUrl: string;
    webId: string;
    http: typeof http;
    owner: ItemOwner | undefined;
  }>();
  useEffect(() => {
    if (!url || isOwnStorage(url, storageUrl)) return;
    let live = true;
    void resolveItemOwner(url, { storageUrl, webId, fetch: http }).then((owner) => {
      if (live) setResult({ url, storageUrl, webId, http, owner });
    });
    return () => {
      live = false;
    };
  }, [url, storageUrl, webId, http]);
  if (url && isOwnStorage(url, storageUrl)) return { webId, label: "Me" };
  return result?.url === url &&
    result?.storageUrl === storageUrl &&
    result?.webId === webId &&
    result?.http === http
    ? result.owner
    : undefined;
}
export function OwnerLabel({ url, fallback = "Unknown" }: { url: string; fallback?: string }) {
  return useItemOwner(url)?.label ?? fallback;
}
