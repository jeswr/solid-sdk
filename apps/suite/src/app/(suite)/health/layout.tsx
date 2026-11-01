// AUTHORED-BY Codex GPT-6
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { HealthApp } from "@/apps/health/components/health-app";
import "@/apps/health/components/health.css";
export const metadata: Metadata = { title: "Health · Solid Suite" };
export default function HealthLayout({ children }: { children: ReactNode }) {
  return <HealthApp>{children}</HealthApp>;
}
