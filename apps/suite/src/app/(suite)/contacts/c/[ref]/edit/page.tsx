// AUTHORED-BY Codex GPT-6.1-Sol
import { ContactEditor } from "@/apps/contacts/components/contact-form";
export default async function EditContactPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  return <ContactEditor contactRef={ref} />;
}
