// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import Link from "next/link";
import { useRoutePathname } from "@/lib/route-params";
import { unionLabels } from "../lib/model/tracker";
import { labelColour } from "../lib/views/label-colours";
import { useTasks } from "../state/tasks-context";
import { LabelDot } from "./label-chip";

/** Label routes provide the existing cross-project filter, preserving browser navigation. */
export function LabelFilterBar({ projectUrl }: { projectUrl?: string | undefined }) {
  const tasks = useTasks();
  const path = useRoutePathname();
  const labels = unionLabels(
    tasks.projects
      .filter((project) => !projectUrl || project.url === projectUrl)
      .map((project) => project.tracker),
  );
  if (!labels.size) return null;
  return (
    <nav className="tsk-label-filter" aria-label="Filter by label">
      <ul>
        {[...labels]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, categories]) => {
            const name = categories[0]?.name ?? key;
            const href = `/tasks/l/${encodeURIComponent(key)}`;
            return (
              <li key={key}>
                <Link
                  className="tsk-chip tsk-label-chip"
                  href={href}
                  aria-current={path === href ? "page" : undefined}
                >
                  <LabelDot colour={labelColour(key, tasks.projects)} />@{name}
                </Link>
              </li>
            );
          })}
      </ul>
    </nav>
  );
}
