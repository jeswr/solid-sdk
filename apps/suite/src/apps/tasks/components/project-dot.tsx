// AUTHORED-BY Codex GPT-6.1-Sol
import { projectColourStyle } from "../lib/views/project-colours";

export function ProjectDot({ colour }: { colour: string | undefined }) {
  return <span className="tsk-project-dot" style={projectColourStyle(colour)} aria-hidden="true" />;
}
