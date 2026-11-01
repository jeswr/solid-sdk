// AUTHORED-BY Codex GPT-6.1-Sol
import { ThreadPage } from "@/apps/mail/components/views";
export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <ThreadPage reference={ref} />;
}
