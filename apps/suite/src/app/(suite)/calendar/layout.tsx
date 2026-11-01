// AUTHORED-BY Codex GPT-6.1-Sol
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { CalendarApp } from "@/apps/calendar/components/calendar-app";
import "@/apps/calendar/components/calendar.css";
export const metadata: Metadata = { title: "Calendar · Solid Suite" };
export default function CalendarLayout({ children }: { children: ReactNode }) {
  return <CalendarApp>{children}</CalendarApp>;
}
