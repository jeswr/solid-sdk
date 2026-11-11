// AUTHORED-BY Codex GPT-6
"use client";
import { isNativeApp } from "@jeswr/suite-native";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { nativeShareIntake, type ShareIntake } from "@/shell/share/intake";

export function NativeShareLaunch({ intake = nativeShareIntake }: { intake?: ShareIntake }) {
  const router = useRouter();
  const pathname = usePathname();
  const currentPath = useRef(pathname);
  currentPath.current = pathname;
  const snapshot = useSyncExternalStore(
    intake.subscribe,
    intake.getSnapshot,
    intake.getServerSnapshot,
  );
  useEffect(() => {
    if (!isNativeApp()) return;
    let live = true;
    let stop: (() => Promise<void>) | undefined;
    const refresh = () => {
      if (live) void intake.refresh();
    };
    // Register before reading pending shares so cold-start and live delivery overlap safely.
    void intake
      .listen()
      .then((unsubscribe) => {
        if (live) stop = unsubscribe;
        else void unsubscribe().catch(() => undefined);
      })
      .catch(() => undefined)
      .finally(refresh);
    const visible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("resume", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      void stop?.().catch(() => undefined);
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("resume", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [intake]);
  useEffect(() => {
    const pathname = currentPath.current;
    // Leave sign-in and its callback uninterrupted while the same batch remains pending.
    if (
      isNativeApp() &&
      snapshot.batches.length > 0 &&
      pathname !== "/share" &&
      !pathname.startsWith("/signin") &&
      !pathname.startsWith("/auth/")
    )
      router.push("/share");
  }, [snapshot.batches, router]);
  return null;
}
