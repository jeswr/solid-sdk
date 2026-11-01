// AUTHORED-BY Codex GPT-6.1-Sol
import { RoomRoute } from "@/apps/chat/components/room";
export default async function RoomPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <RoomRoute reference={ref} />;
}
