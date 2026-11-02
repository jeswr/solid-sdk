// AUTHORED-BY Codex GPT-6.1-Sol
import { NewSpreadsheet } from "@/apps/sheets/components/new-spreadsheet";

export default async function NewPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>;
}) {
  const { src } = await searchParams;
  return <NewSpreadsheet {...(src ? { src } : {})} />;
}
