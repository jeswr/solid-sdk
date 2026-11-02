// AUTHORED-BY Claude Opus 5.5
import { ErrorState } from "@jeswr/suite-ui";
import { BoardView } from "@/apps/tasks/components/board/board-view";
import { decodeRef } from "@/lib/refs";
export const metadata = { title: "Project board · Tasks · Solid Suite" };
export default async function ProjectBoardPage({ params }: { params: Promise<{ ref: string }> }) {
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
  return <BoardView projectUrl={url} />;
}
