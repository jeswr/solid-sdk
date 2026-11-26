// AUTHORED-BY Codex GPT-6.1-Sol
import "@jeswr/suite-charts/styles.css";
import type { Metadata } from "next";
import { KnowledgeView } from "@/apps/health/components/knowledge-view";
export const metadata: Metadata = { title: "What your assistant knows · Health · Solid Suite" };
export default function Page() {
  return <KnowledgeView />;
}
