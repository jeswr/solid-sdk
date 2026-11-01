// AUTHORED-BY Codex GPT-6.1-Sol
import { PreviewFixture } from "../ds11-fixtures";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; kind?: string }>;
}) {
  const params = await searchParams;
  return <PreviewFixture state={params.state ?? "ready"} kind={params.kind ?? "image"} />;
}
