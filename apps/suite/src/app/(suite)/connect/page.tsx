// AUTHORED-BY Codex GPT-6
import { Suspense } from "react";
import { ConnectCatalogue } from "@/apps/home/components/connect/catalogue";
import "@/apps/home/components/connect/connect.css";
export default function Page() {
  return (
    <Suspense fallback={<p role="status">Loading services…</p>}>
      <ConnectCatalogue />
    </Suspense>
  );
}
