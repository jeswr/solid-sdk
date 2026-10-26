// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReminderEvent, ReminderTrigger } from "./types";
import { instant, ReminderError, record } from "./validation";

/** Fixed elapsed time only: nominal calendar durations need timezone-aware resolution. */
export function parseTriggerOffset(offset: string): number {
  if (typeof offset !== "string") throw new ReminderError("invalid-trigger");
  const match = /^([+-]?)PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d{1,3})?)S)?$/.exec(offset);
  if (!match || (match[2] === undefined && match[3] === undefined && match[4] === undefined)) {
    throw new ReminderError("unsupported-trigger");
  }
  const hours = BigInt(match[2] ?? 0);
  const minutes = BigInt(match[3] ?? 0);
  const seconds = match[4] ?? "0";
  const dot = seconds.indexOf(".");
  const secondsMs =
    dot < 0
      ? BigInt(seconds) * BigInt(1000)
      : BigInt(seconds.slice(0, dot)) * BigInt(1000) +
        BigInt(seconds.slice(dot + 1).padEnd(3, "0"));
  const milliseconds = Number(hours * BigInt(3_600_000) + minutes * BigInt(60_000) + secondsMs);
  return instant(match[1] === "-" ? -milliseconds : milliseconds, "invalid-trigger");
}

export function triggerInstant(event: ReminderEvent, trigger: ReminderTrigger): number {
  record(trigger, ["kind", "at", "offset", "related"], "invalid-trigger");
  if (trigger.kind === "absolute") {
    record(trigger, ["kind", "at"], "invalid-trigger");
    return instant(trigger.at);
  }
  if (trigger.kind !== "relative") throw new ReminderError("unsupported-trigger");
  record(trigger, ["kind", "offset", "related"], "invalid-trigger");
  if (trigger.related !== undefined && trigger.related !== "start" && trigger.related !== "end") {
    throw new ReminderError("unsupported-trigger");
  }
  const anchor = trigger.related === "end" ? event.end : event.start;
  if (anchor === undefined) throw new ReminderError("invalid-trigger");
  return instant(anchor + parseTriggerOffset(trigger.offset));
}
