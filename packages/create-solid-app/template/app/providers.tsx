"use client";
// Client boundary that mounts the Solid auth runtime. The auth provider renders
// a browser-only custom element and patches the global fetch, so it must never
// run on the server: we load it with `next/dynamic` + `ssr: false`.
import dynamic from "next/dynamic";
import type { ReactNode } from "react";

const SolidAuthProvider = dynamic(
  () => import("@/components/solid/SolidAuthProvider").then((m) => m.SolidAuthProvider),
  { ssr: false },
);

export function Providers({ children }: { children: ReactNode }) {
  return <SolidAuthProvider>{children}</SolidAuthProvider>;
}
