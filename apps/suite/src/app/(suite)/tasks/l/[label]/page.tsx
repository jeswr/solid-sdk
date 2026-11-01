// AUTHORED-BY Codex GPT-6
import { LabelView } from "@/apps/tasks/components/views/label-view";
export async function generateMetadata({ params }: { params: Promise<{ label: string }> }) {
  const { label } = await params;
  return { title: `@${label} · Tasks · Solid Suite` };
}
export default async function LabelPage({ params }: { params: Promise<{ label: string }> }) {
  const { label } = await params;
  return <LabelView label={label} />;
}
