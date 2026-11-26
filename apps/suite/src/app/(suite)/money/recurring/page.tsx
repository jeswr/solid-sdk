// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
import { Suspense } from "react";
import { MoneyOpening } from "@/apps/money/components/money-states";
import { RecurringScreen } from "@/apps/money/components/recurring";
export default function Page() {
  return (
    <Suspense fallback={<MoneyOpening />}>
      <RecurringScreen />
    </Suspense>
  );
}
