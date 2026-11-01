// AUTHORED-BY Claude Opus 5.5
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { HomeApp } from "@/apps/home/components/home-app";
import "@/apps/home/components/home.css";

export const metadata: Metadata = { title: "Permissions · Solid Suite" };
// Capability overrides (SUITE_TEST_CAPS) are read when a request arrives, not baked in at build.
export const dynamic = "force-dynamic";

export default function Layout({ children }: { children: ReactNode }) {
  return <HomeApp>{children}</HomeApp>;
}
