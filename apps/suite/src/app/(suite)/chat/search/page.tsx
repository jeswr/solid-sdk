// AUTHORED-BY Codex GPT-6.1-Sol
import { ChatSearchPage } from "@/apps/chat/components/search";
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const { q } = await searchParams;
  return <ChatSearchPage query={typeof q === "string" ? q : ""} />;
}
