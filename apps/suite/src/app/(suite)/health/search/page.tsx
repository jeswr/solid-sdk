// AUTHORED-BY Codex GPT-6
import { SearchView } from "@/apps/health/components/search-view";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const query = (await searchParams).q;
  return <SearchView query={typeof query === "string" ? query : (query?.[0] ?? "")} />;
}
