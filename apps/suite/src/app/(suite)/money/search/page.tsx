// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { Suspense } from "react";
import { MoneyOpening } from "@/apps/money/components/money-states";
import { SearchScreen } from "@/apps/money/components/search";
export default function Page() {
  return (
    <Suspense fallback={<MoneyOpening />}>
      <SearchScreen />
    </Suspense>
  );
}
