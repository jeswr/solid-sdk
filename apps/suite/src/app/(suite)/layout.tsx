// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReactNode } from "react";
import { OfflineProvider } from "@/shell/sync/offline-provider";

export default function SuiteLayout({ children }: { children: ReactNode }) {
  return <OfflineProvider>{children}</OfflineProvider>;
}
