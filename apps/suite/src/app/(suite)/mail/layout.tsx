// AUTHORED-BY Codex GPT-6.1-Sol
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MailApp } from "@/apps/mail/components/mail-app";
import "@/apps/mail/components/mail.css";
export const metadata: Metadata = { title: "Mail · Solid Suite" };
export default function MailLayout({ children }: { children: ReactNode }) {
  return <MailApp>{children}</MailApp>;
}
