// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Suspense } from "react";
import { MoneyOpening } from "@/apps/money/components/money-states";
import { AccountsScreen } from "@/apps/money/components/overview";
export default function Page() {
  return (
    <Suspense fallback={<MoneyOpening />}>
      <AccountsScreen overviewPage />
    </Suspense>
  );
}
