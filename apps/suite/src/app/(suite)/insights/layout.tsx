// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { InsightsApp } from "@/apps/insights/components/insights-app";
import "@/apps/insights/components/insights.css";
export const metadata: Metadata = { title: "Insights · Solid Suite" };
export default function Layout({ children }: { children: ReactNode }) {
  return <InsightsApp>{children}</InsightsApp>;
}
