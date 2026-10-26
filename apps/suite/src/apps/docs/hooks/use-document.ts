// AUTHORED-BY Codex
"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { encodeRef } from "@/lib/refs";
import type { PodSession } from "@/lib/session/pod-session";
import { DocumentPersistence } from "../editor/persistence";
export function useDocument(session: PodSession, resource: string | undefined) {
  const router = useRouter();
  const current = useRef<DocumentPersistence | null>(null);
  const [runtime, setRuntime] = useState<DocumentPersistence | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [recovery, setRecovery] = useState(0);
  const [, render] = useState(0);
  useEffect(() => {
    if (current.current && current.current.stored?.url === resource && resource && recovery === 0)
      return;
    let live = true;
    const next = new DocumentPersistence(session);
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
    void next.open(resource, recovery > 0).then(
      () => {
        if (live) {
          next.online = navigator.onLine;
          setRuntime(next);
        }
      },
      (cause: unknown) => {
        if (live) setError(cause);
      },
    );
    return () => {
      live = false;
    };
  }, [session, resource, router, recovery]);
  useEffect(() => {
    const flush = () => {
      void current.current?.flush();
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
    addEventListener("beforeunload", flush);
    addEventListener("offline", offline);
    addEventListener("online", online);
    document.addEventListener("visibilitychange", visibility);
    const timer = setInterval(() => {
      if (document.visibilityState === "visible" && current.current?.online)
        void current.current.provider?.sync().catch(() => {});
      current.current?.notify();
    }, 30_000);
    return () => {
      removeEventListener("pagehide", flush);
      removeEventListener("beforeunload", flush);
      removeEventListener("offline", offline);
      removeEventListener("online", online);
      document.removeEventListener("visibilitychange", visibility);
      clearInterval(timer);
      const last = current.current;
      current.current = null;
      if (last) void last.destroy();
    };
  }, []);
  return { runtime, error, recover: () => setRecovery((n) => n + 1) };
}
