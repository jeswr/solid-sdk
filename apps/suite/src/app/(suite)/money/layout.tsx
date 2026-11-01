// AUTHORED-BY Codex GPT-6
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MoneyApp } from "@/apps/money/components/money-app";
import "@/apps/money/components/money.css";
import "@jeswr/suite-ui/styles/date-time.css";
export const metadata: Metadata = { title: "Money · Solid Suite" };
export default function MoneyLayout({ children }: { children: ReactNode }) {
  return <MoneyApp>{children}</MoneyApp>;
}
