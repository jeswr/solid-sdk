// AUTHORED-BY Codex GPT-6.1-Sol
import type { StoredProject } from "../model/store";
import { projectColour } from "./project-colours";

/** Union labels share the first category's colour in project order, even when neutral. */
export function labelColour(name: string, projects: readonly StoredProject[]): string | undefined {
  const first = projects
    .flatMap((project) => project.tracker.labels)
    .find((label) => label.name.toLowerCase() === name.toLowerCase());
  return projectColour(first?.color)?.hex;
}
