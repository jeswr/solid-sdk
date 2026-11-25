// AUTHORED-BY Codex GPT-6
"use client";
import { createSecureStore, isNativeApp } from "@jeswr/suite-native";
import { useEffect, useRef, useState } from "react";

/** Mounted only on the sign-in surface: consume when the person can see the notice. */
export function NativeMigrationNotice() {
  const [visible, setVisible] = useState(false);
  const request = useRef<Promise<boolean> | null>(null);
  const live = useRef(false);
  useEffect(() => {
    if (!isNativeApp()) return;
    live.current = true;
    let mounted = true;
    // Share one request across StrictMode's effect replay. A real unmount before the lazy
    // import completes leaves the native notice pending for the next sign-in surface.
    request.current ??= import("@jeswr/suite-native/capacitor").then(({ secureStorePlugin }) =>
      live.current ? createSecureStore(secureStorePlugin).takeMigrationNotice() : false,
    );
    void request.current
      .then((notice) => {
        if (mounted && notice) setVisible(true);
      })
      .catch(() => {
        /* A later visit can retry a failed consumption; native details stay off the page. */
      });
    return () => {
      mounted = false;
      live.current = false;
    };
  }, []);
  return visible ? (
    <p role="status" className="shell-public-note">
      Sign in again to continue
    </p>
  ) : null;
}
