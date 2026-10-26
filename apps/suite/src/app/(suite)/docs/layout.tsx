// AUTHORED-BY Codex
import type { ReactNode } from "react";
import { DocsShell } from "@/apps/docs/components/docs-shell";
import "@/apps/docs/components/docs.css";
export default function DocsLayout({ children }: { children: ReactNode }) {
  return <DocsShell>{children}</DocsShell>;
}
