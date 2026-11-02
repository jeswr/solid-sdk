// AUTHORED-BY Claude Opus 5.5
import { notFound } from "next/navigation";
import { HomePage } from "@/apps/home/components/home-page";
import { DOMAINS, UNCATEGORISED } from "@/apps/home/lib/model/domains";

export default async function Page({ params }: { params: Promise<{ domain: string }> }) {
  const { domain } = await params;
  const id = decodeURIComponent(domain);
  if (id !== UNCATEGORISED.id && !DOMAINS.some((entry) => entry.id === id)) notFound();
  return <HomePage domain={id} />;
}
