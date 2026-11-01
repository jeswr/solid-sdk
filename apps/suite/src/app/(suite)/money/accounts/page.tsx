// AUTHORED-BY Codex GPT-6
import { Suspense } from "react";
import { AccountsScreen } from "@/apps/money/components/overview";
export default function Page() {
  return (
    <Suspense>
      <AccountsScreen />
    </Suspense>
  );
}
