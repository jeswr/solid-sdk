// AUTHORED-BY Codex GPT-6.1-Sol
import { RoomRoute } from "@/apps/chat/components/room";
export default async function RoomPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<{ message?: string | string[] }>;
}) {
  const { ref } = await params;
  const { message } = await searchParams;
  return (
    <RoomRoute
      reference={ref}
      messageReference={typeof message === "string" ? message : undefined}
    />
  );
}
