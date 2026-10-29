// AUTHORED-BY Codex
"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import type { PodSession } from "@/lib/session/pod-session";
import { currentDraftId } from "../editor/drafts";
import { DocumentPersistence } from "../editor/persistence";
export function useDocument(session: PodSession, resource: string | undefined) {
  const router = useRouter();
  const draft = useSearchParams().get("draft");
  const current = useRef<DocumentPersistence | null>(null);
  const [runtime, setRuntime] = useState<DocumentPersistence | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [recovery, setRecovery] = useState<{
    session: PodSession;
    resource: string | undefined;
    draft: string | null;
  } | null>(null);
  const consumedRecovery = useRef<typeof recovery>(null);
  const [, render] = useState(0);
  useEffect(() => {
    const request = recovery !== consumedRecovery.current ? recovery : null;
    consumedRecovery.current = recovery;
    const recovering =
      request?.session === session && request.resource === resource && request.draft === draft;
    if (
      current.current?.session === session &&
      current.current.stored?.url === resource &&
      resource &&
      !recovering
    )
      return;
    if (
      !resource &&
      draft &&
      current.current?.session === session &&
      current.current.draftId === draft &&
      !recovering
    )
      return;
    const next = new DocumentPersistence(session, resource ? undefined : currentDraftId());
    const previous = current.current;
    current.current = next;
    if (previous) void previous.destroy();
    setRuntime(null);
    setError(null);
    next.notify = () => {
      if (current.current === next) render((n) => n + 1);
    };
    next.onCreated = (url) => {
      if (current.current === next) router.replace(`/docs/d/${encodeRef(url)}`);
    };
    void next.open(resource, recovering).then(
      () => {
        if (current.current === next) {
          next.online = next.online && navigator.onLine;
          setRuntime(next);
        }
      },
      (cause: unknown) => {
        if (current.current === next) setError(cause);
      },
    );
  }, [session, resource, router, recovery, draft]);
  useEffect(() => {
    const flush = () => {
      void current.current?.flush();
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      // Starting a flush cannot make an uncommitted edit safe to close.
      if (current.current?.hasUnsavedChanges) {
        event.preventDefault();
        event.returnValue = "";
      }
      flush();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const offline = () => {
      if (current.current) {
        current.current.online = false;
        current.current.notify();
      }
    };
    const online = () => {
      void current.current?.reconnect();
    };
    addEventListener("pagehide", flush);
    addEventListener("beforeunload", beforeUnload);
    addEventListener("offline", offline);
    addEventListener("online", online);
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && current.current?.online)
        void current.current.reconnect();
      current.current?.notify();
    }, 30_000);
    return () => {
      removeEventListener("pagehide", flush);
      removeEventListener("beforeunload", beforeUnload);
      removeEventListener("offline", offline);
      removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visibility);
      clearInterval(timer);
      const last = current.current;
      current.current = null;
      if (last) void last.destroy();
    };
  }, []);
  return {
    runtime,
    error,
    recover: () => {
      setRecovery({ session, resource, draft });
    },
  };
}
