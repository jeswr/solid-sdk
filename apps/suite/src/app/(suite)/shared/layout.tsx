// AUTHORED-BY Codex GPT-6.1-Sol
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { HomeApp } from "@/apps/home/components/home-app";
import "@/apps/home/components/home.css";
import "@/lib/shared/shared.css";
export const metadata: Metadata = { title: "Shared with me · Solid Suite" };
export default function Layout({ children }: { children: ReactNode }) {
  return <HomeApp>{children}</HomeApp>;
}
