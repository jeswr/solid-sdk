// AUTHORED-BY Codex GPT-6.1-Sol
import { FolderPage } from "@/apps/mail/components/views";
export default async function Page({ params }: { params: Promise<{ folder: string }> }) {
  const { folder } = await params;
  return <FolderPage folderKey={folder} />;
}
