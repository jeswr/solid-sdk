// AUTHORED-BY Codex GPT-6
import { WorkoutView } from "@/apps/health/components/workouts-view";
export default async function Page({ params }: { params: Promise<{ ref: string }> }) {
  const values = await params;
  return <WorkoutView reference={values.ref} />;
}
