// AUTHORED-BY Codex GPT-6
import { notFound } from "next/navigation";
import { entries } from "@/apps/home/components/connect/config";
import { ConnectFlow } from "@/apps/home/components/connect/flow";
import "@/apps/home/components/connect/connect.css";

export default async function Page({ params }: { params: Promise<{ service: string }> }) {
  const { service } = await params;
  if (!entries.some((entry) => entry.id === service)) notFound();
  return <ConnectFlow service={service} />;
}
