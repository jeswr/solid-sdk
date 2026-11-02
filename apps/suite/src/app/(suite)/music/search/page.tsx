// AUTHORED-BY Codex GPT-6
import { MusicScreen } from "@/apps/music/components/music-screen";
export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { q } = await searchParams;
  return <MusicScreen view="search" query={q ?? ""} />;
}
