// AUTHORED-BY Codex GPT-6.1-Sol
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SheetsApp } from "@/apps/sheets/components/sheets-app";
import "@/apps/sheets/components/sheets.css";

export const metadata: Metadata = { title: "Sheets · Solid Suite" };
export default function SheetsLayout({ children }: { children: ReactNode }) {
  return <SheetsApp>{children}</SheetsApp>;
}
