// AUTHORED-BY Codex GPT-6.1-Sol
import { projectColourStyle } from "../lib/views/project-colours";

export function LabelDot({ colour }: { colour: string | undefined }) {
  return <span className="tsk-label-dot" style={projectColourStyle(colour)} aria-hidden="true" />;
}

export function LabelChip({ name, colour }: { name: string; colour: string | undefined }) {
  return (
    <span className="tsk-chip tsk-label-chip">
      <LabelDot colour={colour} />@{name}
    </span>
  );
}
