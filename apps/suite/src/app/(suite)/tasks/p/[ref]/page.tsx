// AUTHORED-BY Codex GPT-6
import { ErrorState } from "@jeswr/suite-ui";
import { ProjectView } from "@/apps/tasks/components/views/project-view";
import { decodeRef } from "@/lib/refs";
export const metadata = { title: "Project · Tasks · Solid Suite" };
export default async function ProjectPage({ params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  let url: string;
  try {
    url = decodeRef(ref);
  } catch {
    return (
      <div className="tsk-content">
        <h1>Project</h1>
        <ErrorState error="not-found" />
      </div>
    );
  }
  return <ProjectView projectUrl={url} />;
}
