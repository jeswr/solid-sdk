// AUTHORED-BY Codex GPT-6.1-Sol
"use client";

import { toast } from "@jeswr/suite-ui";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { useNeedsConnection } from "@/shell/sync/requires-online";
import type { DriveItem } from "../lib/client/client";
import { useDrive } from "./drive-context";
import { useDriveUi } from "./ui";

type OpenWithState =
  | { readonly kind: "open"; readonly href: string }
  | { readonly kind: "convert"; readonly disabledReason?: string };

export type OpenWithControl = OpenWithState & {
  readonly run: () => Promise<void>;
  readonly pending: boolean;
};

type ProbeSession = Pick<PodSession, "storageUrl" | "fetch">;
interface OpenWithTarget {
  readonly name: string;
  state(
    item: DriveItem,
    context: {
      storageUrl: string;
      offlineReason?: string | undefined;
      writable?: boolean | undefined;
    },
  ): OpenWithState | undefined;
  probeWritable(session: ProbeSession): Promise<boolean | undefined>;
  /** Recheck access before importing; return the created resource and its editor. */
  convert(
    item: DriveItem,
    session: PodSession,
  ): Promise<{ url: string; href: string; warning?: string | undefined }>;
}

const FALLBACK = "Your file wasn't changed. Check your connection and try again.";

/** Importer messages are plain Errors; storage/transport errors may contain private URLs. */
function failureDescription(error: unknown): string {
  return error instanceof Error && error.constructor === Error && error.message
    ? error.message
    : FALLBACK;
}

/** Bind one Drive-local controller to an editor, with a separate permission cache per target. */
export function createOpenWithController(target: OpenWithTarget) {
  const probes = new WeakMap<ProbeSession, Promise<boolean | undefined>>();

  function writable(session: ProbeSession): Promise<boolean | undefined> {
    let pending = probes.get(session);
    if (!pending) {
      pending = target.probeWritable(session).then((value) => {
        probes.delete(session);
        return value;
      });
      probes.set(session, pending);
    }
    return pending;
  }

  /** Share concurrent probes; later openings recheck permissions. */
  function useWritable(session: ProbeSession, enabled: boolean): boolean | undefined {
    const [known, setKnown] = useState<{ session: ProbeSession; writable: boolean | undefined }>();
    useEffect(() => {
      if (!enabled) return;
      let live = true;
      void writable(session).then((value) => {
        if (live) setKnown({ session, writable: value });
      });
      return () => {
        live = false;
      };
    }, [session, enabled]);
    return known?.session === session ? known.writable : undefined;
  }

  function useOpenWith(item: DriveItem | undefined): OpenWithControl | undefined {
    const { session, invalidate } = useDrive();
    // An unsaved text edit in the preview may veto leaving it (#406).
    const { mayLeavePreview } = useDriveUi();
    const router = useRouter();
    const connection = useNeedsConnection();
    const base = item && target.state(item, { storageUrl: session.storageUrl });
    const access = useWritable(
      session,
      base?.kind === "convert" && base.disabledReason === undefined && !connection.disabled,
    );
    const busy = useRef(false);
    const [pending, setPending] = useState(false);
    if (!item) return undefined;
    const state = target.state(item, {
      storageUrl: session.storageUrl,
      offlineReason: connection.disabled ? connection.reason : undefined,
      writable: access,
    });
    if (!state) return undefined;
    const run = async () => {
      if (!mayLeavePreview()) return;
      if (state.kind === "open") {
        router.push(state.href);
        return;
      }
      if (state.disabledReason !== undefined || busy.current) return;
      busy.current = true;
      setPending(true);
      const loading = toast.loading(`Opening ${item.name} with ${target.name}…`);
      try {
        const result = await target.convert(item, session);
        invalidate(result.url);
        toast.dismiss(loading);
        if (result.warning)
          toast.warning("Some items weren't imported", {
            description: result.warning,
            duration: Number.POSITIVE_INFINITY,
          });
        if (mayLeavePreview()) router.push(result.href);
      } catch (error) {
        toast.dismiss(loading);
        toast.error(`Couldn't open ${item.name} with ${target.name}`, {
          description: failureDescription(error),
        });
      } finally {
        busy.current = false;
        setPending(false);
      }
    };
    return { ...state, run, pending };
  }

  return { useOpenWith, useWritable };
}
