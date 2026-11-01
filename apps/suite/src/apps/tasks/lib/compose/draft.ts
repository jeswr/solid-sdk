// AUTHORED-BY Codex GPT-6.1-Sol
import type { Reminder } from "../model/reminders";
import {
  type Chip,
  type ChipId,
  type ChipKind,
  type ComposeContext,
  type ComposeDue,
  type ComposeResult,
  parseQuickAdd,
} from "./quick-add";

export interface ComposeOverrides {
  due?: ComposeDue | null;
  priority?: 1 | 2 | 3 | 4;
  projectUrl?: string;
  labels?: string[];
  reminders?: Reminder[];
}

/** Controls replace interpretations, while token spans and the parsed title remain intact. */
export function applyControls(
  parsed: ComposeResult,
  controls: ComposeOverrides,
  ctx: ComposeContext,
  text = "",
): ComposeResult {
  const result = { ...parsed, chips: [...parsed.chips] };
  const replace = (kind: ChipKind, labels: string[]) => {
    const original = parsed.chips.filter((chip) => chip.kind === kind);
    result.chips = result.chips.filter((chip) => chip.kind !== kind);
    result.chips.push(
      ...labels.map(
        (label, index): Chip => ({
          id: original[index]?.id ?? `${kind}:${-1 - index}`,
          kind,
          label,
          span: original[index]?.span ?? { start: 0, end: 0 },
        }),
      ),
    );
  };
  if (controls.due !== undefined) {
    if (controls.due) result.due = controls.due;
    else delete result.due;
    // Reuse the parser's relative date copy and time-zone handling.
    const dueChip =
      controls.due &&
      parseQuickAdd("", {
        ...ctx,
        defaults: { due: controls.due },
        keepText: new Set(),
      }).chips.find((chip) => chip.kind === "due");
    replace("due", dueChip ? [dueChip.label] : []);
    // The parser drops reminders without a deadline. A manual date makes those
    // tokens valid again, while previously removed date text stays literal.
    if (controls.due && !parsed.due && controls.reminders === undefined) {
      const scheduled = parseQuickAdd(text, {
        ...ctx,
        defaults: { ...ctx.defaults, due: controls.due },
        keepText: new Set([...(ctx.keepText ?? [])].filter((id) => !id.startsWith("due:"))),
      });
      result.reminders = scheduled.reminders;
      result.chips = result.chips.map((chip) =>
        chip.kind === "reminder" ? { ...chip, invalid: false } : chip,
      );
    }
  }
  if (controls.priority !== undefined) {
    result.priority = controls.priority;
    replace("priority", [`P${controls.priority}`]);
  }
  if (controls.projectUrl !== undefined) {
    result.project = { kind: "existing", url: controls.projectUrl };
    if (controls.projectUrl !== ctx.defaults?.projectUrl) {
      delete result.sectionId;
      replace("section", []);
    } else if (ctx.defaults?.sectionId && !ctx.keepText?.has("section:0")) {
      result.sectionId = ctx.defaults.sectionId;
      replace("section", [ctx.defaults.sectionName ?? "Section"]);
    }
    replace("project", [
      `#${ctx.projects.find((project) => project.url === controls.projectUrl)?.title ?? "Project"}`,
    ]);
  }
  if (controls.labels !== undefined) {
    result.labels = controls.labels.map((name) => ({ name, existing: ctx.labels.includes(name) }));
    replace(
      "label",
      controls.labels.map((name) => `@${name}`),
    );
  }
  if (controls.reminders !== undefined) {
    result.reminders = controls.reminders;
    replace(
      "reminder",
      controls.reminders.map(
        (reminder) =>
          `Remind ${reminder.time !== undefined ? reminder.time.toLocaleString() : reminder.offset === "PT0S" ? "at due time" : reminder.offset === "-PT1H" ? "1 hour before" : "1 day before"}`,
      ),
    );
  }
  if (!result.due) {
    result.reminders = [];
    result.chips = result.chips.map((chip) =>
      chip.kind === "reminder" ? { ...chip, invalid: true } : chip,
    );
  }
  return result;
}

/** Keep removed tokens literal when an edit moves, but does not alter, their spans. */
export function rebaseKeepText(
  before: string,
  after: string,
  kept: Set<ChipId>,
  ctx: ComposeContext,
): Set<ChipId> {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix])
    prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before.at(-1 - suffix) === after.at(-1 - suffix)
  )
    suffix++;
  const result = new Set<ChipId>();
  for (const id of kept) {
    const chip = parseQuickAdd(before, { ...ctx, keepText: new Set() }).chips.find(
      (chip) => chip.id === id,
    );
    if (!chip || chip.span.start === chip.span.end) {
      result.add(id);
      continue;
    }
    if (chip.span.end <= prefix) result.add(id);
    else if (chip.span.start >= before.length - suffix)
      result.add(`${chip.kind}:${chip.span.start + after.length - before.length}`);
  }
  return result;
}
