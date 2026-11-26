// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Suspense } from "react";
import { ImportScreen } from "@/apps/money/components/import";
import { MoneyOpening } from "@/apps/money/components/money-states";
export default function Page() {
  return (
    <Suspense fallback={<MoneyOpening />}>
      <ImportScreen />
    </Suspense>
  );
}
