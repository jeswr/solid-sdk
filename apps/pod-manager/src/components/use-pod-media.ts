// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { useEffect, useState } from "react";
import { useSession } from "./session-provider";
import { isInOwnPods } from "@/lib/pod-scope";
import { inertBlob } from "@/lib/viewers";

/** Private Pod images need explicit auth too. Public foreign artwork keeps its existing URL. */
export function usePodMedia(url: string | undefined): string | undefined {
  const { podFetch, profile, status, webId } = useSession();
  const privateAsset = !!url && isInOwnPods(url, profile?.storages ?? []);
  const [loaded, setLoaded] = useState<{ url: string; objectUrl: string; webId?: string }>();
  useEffect(() => {
    if (!url || !privateAsset || status !== "logged-in") return;
    let disposed = false;
    let objectUrl: string | undefined;
    const abort = new AbortController();
    void podFetch(url, { signal: abort.signal })
      .then(async (response) => {
        if (!response.ok) return;
        const blob = await response.blob();
        if (disposed) return;
        objectUrl = URL.createObjectURL(inertBlob(blob));
        setLoaded({ url, objectUrl, webId });
      })
      .catch(() => {});
    return () => {
      disposed = true;
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, privateAsset, podFetch, status, webId]);
  return privateAsset
    ? status === "logged-in" && loaded?.url === url && loaded.webId === webId
      ? loaded.objectUrl
      : undefined
    : url;
}
