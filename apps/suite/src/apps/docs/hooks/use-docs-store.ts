// AUTHORED-BY Codex
"use client";
import { useMemo } from "react";
import type { PodSession } from "@/lib/session/pod-session";
import { createDocsStore } from "../lib/model";
export function useDocsStore(session: PodSession) {
  return useMemo(
    () =>
      createDocsStore({
        podRoot: session.storageUrl,
        webId: session.webId,
        fetchImpl: session.fetch,
      }),
    [session],
  );
}
