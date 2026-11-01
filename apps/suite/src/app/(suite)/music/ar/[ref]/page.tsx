// AUTHORED-BY Codex GPT-6
import { MusicScreen } from "@/apps/music/components/music-screen";
export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <MusicScreen view="artist" reference={ref} />;
}
