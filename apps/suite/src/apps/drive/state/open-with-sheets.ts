// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { toast } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useNeedsConnection } from "@/shell/sync/requires-online";
import type { DriveItem } from "../lib/client/client";
import {
  type OpenWithSheetsState,
  openWithSheets,
  openWithSheetsState,
  probeSheetsWritable,
  SHEETS_READ_ONLY_REASON,
  type SheetsSession,
  sheetsHref,
} from "../lib/open-with/sheets";
import { useDrive } from "./drive-context";

const probes = new WeakMap<SheetsSession, Promise<boolean | undefined>>();
function sheetsWritable(session: SheetsSession) {
  let pending = probes.get(session);
  if (!pending) {
    pending = probeSheetsWritable(session).then((value) => {
      probes.delete(session);
      return value;
    });
    probes.set(session, pending);
  }
  return pending;
}

export type OpenWithSheetsControl = OpenWithSheetsState & {
  readonly run: () => Promise<void>;
  readonly pending: boolean;
};

export function useOpenWithSheets(item: DriveItem | undefined): OpenWithSheetsControl | undefined {
  const { session, invalidate } = useDrive();
  const router = useRouter();
  const connection = useNeedsConnection();
  const base = item && openWithSheetsState(item, { storageUrl: session.storageUrl });
  const enabled = base?.kind === "convert" && !base.disabledReason && !connection.disabled;
  const [known, setKnown] = useState<{ session: SheetsSession; writable: boolean | undefined }>();
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void sheetsWritable(session).then((writable) => {
      if (live) setKnown({ session, writable });
    });
    return () => {
      live = false;
    };
  }, [session, enabled]);
  if (!item) return undefined;
  const state = openWithSheetsState(item, {
    storageUrl: session.storageUrl,
    offlineReason: connection.disabled ? connection.reason : undefined,
    sheetsWritable: known?.session === session ? known.writable : undefined,
  });
  if (!state) return undefined;
  const run = async () => {
    if (state.kind === "open") {
      router.push(state.href);
      return;
    }
    if (state.disabledReason || busy.current) return;
    busy.current = true;
    setPending(true);
    const loading = toast.loading(`Opening ${item.name} with Sheets…`);
    try {
      const { createWorkbookService } = await import("../../sheets/lib/workbook");
      const service = createWorkbookService({
        fetch: session.fetch,
        podRoot: session.storageUrl,
        webId: session.webId,
      });
      const book = await openWithSheets(item, session, service);
      invalidate(book.container);
      router.push(sheetsHref(book.container));
    } catch (error) {
      const denied =
        typeof error === "object" &&
        error !== null &&
        "status" in error &&
        (error.status === 401 || error.status === 403);
      toast.error(`Couldn't open ${item.name} with Sheets`, {
        description: denied
          ? SHEETS_READ_ONLY_REASON
          : error instanceof Error && error.message
            ? error.message
            : "Your file wasn't changed. Check your connection and try again.",
      });
    } finally {
      toast.dismiss(loading);
      busy.current = false;
      setPending(false);
    }
  };
  return { ...state, run, pending };
}
