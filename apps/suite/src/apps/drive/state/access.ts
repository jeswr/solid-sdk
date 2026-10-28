// AUTHORED-BY Codex
"use client";

import { useEffect, useState } from "react";
import { accessControl, accessLabel } from "../lib/client/access";
import { useDrive } from "./drive-context";
import { useResourceVersion } from "./resource";

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
    void accessControl(http, storageUrl)
      .effective(url)
      .then((access) => {
        if (live)
          setResult({
            url,
            http,
            storageUrl,
            webId,
            version,
            label: accessLabel(access, url, webId),
          });
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
