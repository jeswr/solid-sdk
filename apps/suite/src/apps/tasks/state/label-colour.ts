// AUTHORED-BY Codex GPT-6.1-Sol
import { toast } from "@jeswr/suite-ui";
import { node, SCHEMA } from "../lib/model/rdf";
import { runBulk } from "../lib/views/bulk";
import { projectColour } from "../lib/views/project-colours";
import type { TasksContextValue } from "./tasks-context";
import { labelTargets } from "./view-actions";

/** Conditional tracker writes retain successes; the summary retries only failed projects. */
export async function setLabelColour(
  key: string,
  colour: string | undefined,
  { cache }: Pick<TasksContextValue, "cache">,
) {
  const selected = projectColour(colour);
  if (colour !== undefined && !selected) throw new TypeError("Unknown label colour.");
  const write = async (targets: ReturnType<typeof labelTargets>) => {
    const result = await runBulk(targets, async ({ project }) => {
      const saved = await cache.updateProject(
        project,
        (tracker) => {
          for (const label of tracker.labels)
            if (label.name.toLowerCase() === key.toLowerCase())
              node(label.id, tracker.dataset).setText(`${SCHEMA}color`, selected?.hex);
        },
        undefined,
        () => {}, // One summary toast owns feedback and Retry for the complete action.
      );
      if (!saved) throw new Error("Couldn't save your changes");
    });
    if (result.failed.length)
      toast.error(
        `Changed colour in ${result.done.length} of ${targets.length} projects — ${result.failed.length} failed`,
        {
          description: `Failed: ${result.failed.map(({ item }) => item.project.tracker.title ?? "Project").join(", ")}`,
          action: {
            label: "Retry",
            onClick: () => {
              void write(result.failed.map(({ item }) => item));
            },
          },
        },
      );
    return result;
  };
  return write(labelTargets(key, cache.getSnapshot().projects));
}
