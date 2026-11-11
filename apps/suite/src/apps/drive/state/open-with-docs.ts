// AUTHORED-BY Codex GPT-6.1
"use client";
/**
 * "Open with Docs" for one Drive item: the rules from `lib/open-with/docs`
 * bound to the session, connection and Docs-folder access, plus the action.
 * Converting creates a new Docs document from the file (the original is never
 * written) and opens it; a failure leaves nothing behind and says so.
 */

import { toast } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useNeedsConnection } from "@/shell/sync/requires-online";
import type { DriveItem } from "../lib/client/client";
import {
  DOCS_READ_ONLY_REASON,
  docsHref,
  type OpenWithDocsState,
  openWithDocsState,
  probeDocsWritable,
  skippedSummary,
} from "../lib/open-with/docs";
import { useDrive } from "./drive-context";

type ProbeSession = Parameters<typeof probeDocsWritable>[0];
const probes = new WeakMap<ProbeSession, Promise<boolean | undefined>>();

/** Share concurrent probes; later openings recheck permissions. */
function docsWritable(session: ProbeSession): Promise<boolean | undefined> {
  let pending = probes.get(session);
  if (!pending) {
    pending = probeDocsWritable(session).then((writable) => {
      probes.delete(session);
      return writable;
    });
    probes.set(session, pending);
  }
  return pending;
}

/** Whether the account can create Docs documents; probed only when `enabled`. */
export function useDocsWritable(session: ProbeSession, enabled: boolean): boolean | undefined {
  const [known, setKnown] = useState<{ session: ProbeSession; writable: boolean | undefined }>();
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void docsWritable(session).then((writable) => {
      if (live) setKnown({ session, writable });
    });
    return () => {
      live = false;
    };
  }, [session, enabled]);
  return known?.session === session ? known.writable : undefined;
}

export type OpenWithDocsControl = OpenWithDocsState & {
  /** Open the document, or convert the file into a new one and open that. */
  readonly run: () => Promise<void>;
  /** A conversion is in progress. */
  readonly pending: boolean;
};

const FALLBACK = "Your file wasn't changed. Check your connection and try again.";

/** User-facing importer messages are plain `Error`s; anything else gets the fallback. */
function failureDescription(error: unknown): string {
  return error instanceof Error && error.constructor === Error && error.message
    ? error.message
    : FALLBACK;
}

export function useOpenWithDocs(item: DriveItem | undefined): OpenWithDocsControl | undefined {
  const { session, invalidate } = useDrive();
  const router = useRouter();
  const connection = useNeedsConnection();
  const base = item && openWithDocsState(item, { storageUrl: session.storageUrl });
  const writable = useDocsWritable(
    session,
    base?.kind === "convert" && base.disabledReason === undefined && !connection.disabled,
  );
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  if (!item) return undefined;
  const state = openWithDocsState(item, {
    storageUrl: session.storageUrl,
    offlineReason: connection.disabled ? connection.reason : undefined,
    docsWritable: writable,
  });
  if (!state) return undefined;
  const run = async () => {
    if (state.kind === "open") {
      router.push(state.href);
      return;
    }
    if (state.disabledReason !== undefined || busy.current) return;
    busy.current = true;
    setPending(true);
    const loading = toast.loading(`Opening ${item.name} with Docs…`);
    try {
      // Recheck at activation: access may have changed since the menu opened.
      if ((await probeDocsWritable(session)) === false) throw new Error(DOCS_READ_ONLY_REASON);
      // The converters and editor stack load only when someone converts.
      const { openWithDocs } = await import("../../docs/hooks/open-with-docs");
      const result = await openWithDocs({ url: item.url, name: item.name }, session, () => {});
      invalidate(result.url);
      toast.dismiss(loading);
      if (result.skipped.length)
        toast.warning("Some items weren't imported", {
          description: skippedSummary(result.skipped),
          duration: Number.POSITIVE_INFINITY,
        });
      router.push(docsHref(result.url));
    } catch (error) {
      toast.dismiss(loading);
      toast.error(`Couldn't open ${item.name} with Docs`, {
        description: failureDescription(error),
      });
    } finally {
      busy.current = false;
      setPending(false);
    }
  };
  return { ...state, run, pending };
}
