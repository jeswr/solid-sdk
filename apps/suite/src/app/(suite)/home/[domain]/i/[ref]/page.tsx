// AUTHORED-BY Codex GPT-6
import { ItemPage } from "@/apps/home/components/item/item-page";
export default async function Page({
  params,
}: {
  params: Promise<{ domain: string; ref: string }>;
}) {
  const { domain, ref } = await params;
  return <ItemPage domain={domain} itemRef={ref} />;
}
