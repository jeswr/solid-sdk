// AUTHORED-BY Codex GPT-6.1-Sol
import { UploadFixture } from "../ds11-fixtures";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; kind?: string }>;
}) {
  const params = await searchParams;
  return <UploadFixture state={params.state ?? "ready"} />;
}
