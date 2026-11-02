"use client";

import { useCallback, useEffect, useState } from "react";
import { parseRdf } from "@jeswr/fetch-rdf";
import type { DatasetCore } from "@rdfjs/types";
import { useSession } from "@/components/session-provider";
import { chooseViewer, type ViewerChoice } from "@/lib/viewers";
import { readResourceProperties, type PropertyGroup } from "@/lib/resource-view";

/** A fetched resource ready to render: its viewer choice + decoded content. */
export interface LoadedResource {
  url: string;
  /** Authenticated binary preview, revoked when the resource changes or unmounts. */
  objectUrl?: string;
  viewer: ViewerChoice;
  contentType?: string;
  size?: number;
  /** Decoded text body (for text/RDF kinds). */
  text?: string;
  /** Parsed RDF property groups (for the `rdf` kind). */
  properties?: PropertyGroup[];
  /**
   * Parsed RDF quads (for the `rdf` kind) — fed to the typed-view registry so a
   * known shape renders a domain view; absent → generic table only. Already
   * parsed for `properties`, so no extra fetch (see typed-data-views §4.5).
   */
  dataset?: DatasetCore;
  /** Optional Type-Index category id the resource was discovered under. */
  categoryId?: string;
  /**
   * The resource's ETag from the GET, kept for a later conditional write
   * (inline editing — Wave 5). Absent when the server sent none.
   */
  etag?: string | null;
}

/**
 * Fetch a single Pod resource through the session transport. Binary previews
 * use object URLs so browser elements can render authenticated responses.
 */
export function useResource(url: string): {
  data?: LoadedResource;
  error?: Error;
  loading: boolean;
  /** Re-fetch the resource (e.g. after a stale-ETag write conflict). */
  reload: () => void;
} {
  const { status, podFetch } = useSession();
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  const [state, setState] = useState<{
    data?: LoadedResource;
    error?: Error;
    loading: boolean;
  }>({ loading: true });

  useEffect(() => {
    if (status !== "logged-in") { setState({ loading: true }); return; }
    let cancelled = false;
    let objectUrl: string | undefined;
    setState({ loading: true });

    (async () => {
      // Always revalidate (no-cache) so a reload after an edit reads the fresh
      // body + ETag rather than a heuristically-cached copy (see rdf-read.ts).
      const res = await podFetch(url, { headers: { accept: "*/*", "cache-control": "no-cache" } });
      if (!res.ok) {
        throw Object.assign(new Error(`Request failed (${res.status})`), {
          status: res.status,
        });
      }
      const contentType = res.headers.get("content-type") ?? undefined;
      const sizeHeader = res.headers.get("content-length");
      const size = sizeHeader ? Number(sizeHeader) : undefined;
      const viewer = chooseViewer(contentType, url);

      const loaded: LoadedResource = {
        url,
        viewer,
        contentType,
        size,
        etag: res.headers.get("etag"),
      };

      if (viewer.kind === "rdf") {
        const body = await res.text();
        loaded.text = body;
        const dataset = await parseRdf(body, viewer.mediaType, { baseIRI: url });
        loaded.properties = readResourceProperties(url, dataset);
        // Keep the parsed dataset so the typed-view registry can select a
        // domain view (contacts/etc.); no extra fetch — same parse.
        loaded.dataset = dataset;
      } else if (viewer.kind === "text" && viewer.embeddable) {
        loaded.text = await res.text();
      } else {
        const blob = await res.blob();
        if (cancelled) return;
        // Unknown/active formats are download-only, including when a link is opened in a new tab.
        const preview = viewer.embeddable ? blob : new Blob([blob], { type: "application/octet-stream" });
        objectUrl = URL.createObjectURL(preview);
        loaded.objectUrl = objectUrl;
      }

      if (!cancelled) setState({ loading: false, data: loaded });
    })().catch((e: unknown) => {
      if (!cancelled) {
        setState({ loading: false, error: e instanceof Error ? e : new Error(String(e)) });
      }
    });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, status, refresh, podFetch]);

  return { ...state, reload };
}
