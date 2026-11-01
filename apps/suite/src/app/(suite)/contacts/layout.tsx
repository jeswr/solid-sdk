// AUTHORED-BY Codex GPT-6.1-Sol
import type { Metadata } from "next";
import { type ReactNode, Suspense } from "react";
import { ContactsApp } from "@/apps/contacts/components/contacts-app";
import "@/apps/contacts/components/contacts.css";
export const metadata: Metadata = { title: "Contacts · Solid Suite" };
export default function ContactsLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<p role="status">Opening Contacts…</p>}>
      <ContactsApp>{children}</ContactsApp>
    </Suspense>
  );
}
