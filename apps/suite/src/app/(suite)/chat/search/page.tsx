// AUTHORED-BY Codex GPT-6.1-Sol
import { Suspense } from "react";
import { ChatSearchRoute } from "@/apps/chat/components/search";
export default function SearchPage() {
  return (
    <Suspense>
      <ChatSearchRoute />
    </Suspense>
  );
}
