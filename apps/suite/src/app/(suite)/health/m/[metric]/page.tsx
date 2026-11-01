// AUTHORED-BY Codex GPT-6
import { MetricView } from "@/apps/health/components/metric-view";
export default async function Page({ params }: { params: Promise<{ metric: string }> }) {
  const values = await params;
  return <MetricView metric={values.metric} />;
}
