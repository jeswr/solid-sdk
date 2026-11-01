// AUTHORED-BY Claude Opus 5.5
"use client";
import { ErrorState, LoadingSkeleton } from "@jeswr/suite-ui";
import { decodeRef } from "@/lib/refs";
import { useRouteParams } from "@/lib/route-params";
import { LabelView } from "./views/label-view";
import { ProjectView } from "./views/project-view";

/** Reads the project ref on the client, so the native export's placeholder page works too. */
export function ProjectRoute() {
  const params = useRouteParams<{ ref: string }>("/tasks/p/[ref]");
  // Only the literal placeholder path (`/tasks/p/__/`) has no params.
  if (!params) return <LoadingSkeleton preset="list" />;
  let url: string;
  try {
    url = decodeRef(params.ref);
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

/** Reads the label on the client, so the native export's placeholder page works too. */
export function LabelRoute() {
  const params = useRouteParams<{ label: string }>("/tasks/l/[label]");
  if (!params) return <LoadingSkeleton preset="list" />;
  return <LabelView label={params.label} />;
}
