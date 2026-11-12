// AUTHORED-BY Codex (GPT-6.1 Sol)
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { FormsApp } from "@/apps/forms/components/forms-app";
import "@/apps/forms/components/forms.css";
export const metadata: Metadata = { title: "Forms · Solid Suite" };
export default function FormsLayout({ children }: { children: ReactNode }) {
  return <FormsApp>{children}</FormsApp>;
}
