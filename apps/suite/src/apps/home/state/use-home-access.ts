// AUTHORED-BY Claude Opus 5.5
"use client";
import { useEffect, useState } from "react";
import { loadPermissions, type PermissionsSnapshot } from "../lib/permissions";
import type { HomeSession } from "./use-domain-items";

export type HomeAccess = PermissionsSnapshot["summary"] | "failed";

export function useHomeAccess(session: HomeSession, version: number) {
  const [access, setAccess] = useState<HomeAccess>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: revalidate after Home refreshes
  useEffect(() => {
    const controller = new AbortController();
    if (!navigator.onLine) {
      setAccess("failed");
      return () => controller.abort();
    }
    setAccess(undefined);
    loadPermissions({
      fetch: session.fetch,
      storage: session.storageUrl,
      webId: session.webId,
      signal: controller.signal,
    }).then(
      (snapshot) => {
        if (!controller.signal.aborted)
          setAccess(snapshot.failures.length || snapshot.truncated ? "failed" : snapshot.summary);
      },
      () => {
        if (!controller.signal.aborted) setAccess("failed");
      },
    );
    return () => controller.abort();
  }, [session, version]);
  return access;
}
