// AUTHORED-BY Codex GPT-6.1-Sol
import { all, type Component, escapeText, one, requireIcs, unescapeText } from "./content";
import { basicDate, readDate, utc } from "./dates";
import { positive } from "./recurrence";
import type { Reminder } from "./types";

function duration(value: string): void {
  requireIcs(
    /^[+-]?P(?:\d+W|\d+D(?:T(?:\d+H(?:\d+M)?(?:\d+S)?|\d+M(?:\d+S)?|\d+S))?|T(?:\d+H(?:\d+M)?(?:\d+S)?|\d+M(?:\d+S)?|\d+S))$/.test(
      value,
    ),
    "invalid duration",
  );
}

function uri(value: string): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: URI values must reject control characters.
  requireIcs(/^[a-z][a-z\d+.-]*:[^\s\x00-\x1f\x7f]+$/i.test(value), "invalid URI");
}

export function alarmLines(alarm: Reminder): string[] {
  requireIcs(["DISPLAY", "AUDIO", "EMAIL"].includes(alarm.action), "unsupported alarm action");
  requireIcs(
    (alarm.triggerOffset !== undefined) !== (alarm.triggerTime !== undefined),
    "expected exactly one alarm trigger",
  );
  const lines = ["BEGIN:VALARM", `ACTION:${alarm.action}`];
  if (alarm.triggerOffset !== undefined) {
    duration(alarm.triggerOffset);
    requireIcs(
      alarm.related === undefined || ["START", "END"].includes(alarm.related),
      "invalid trigger relationship",
    );
    lines.push(
      `TRIGGER${alarm.related === undefined ? "" : `;RELATED=${alarm.related}`}:${alarm.triggerOffset}`,
    );
  } else {
    utc(alarm.triggerTime as string);
    requireIcs(alarm.related === undefined, "absolute trigger cannot have RELATED");
    lines.push(`TRIGGER;VALUE=DATE-TIME:${basicDate(alarm.triggerTime as string)}`);
  }
  requireIcs(
    (alarm.repeat === undefined) === (alarm.duration === undefined),
    "REPEAT and DURATION must occur together",
  );
  if (alarm.repeat !== undefined) {
    positive(alarm.repeat);
    duration(alarm.duration as string);
    requireIcs(
      !/^-/.test(alarm.duration as string) && /[1-9]/.test(alarm.duration as string),
      "alarm repeat duration must be positive",
    );
    lines.push(`REPEAT:${alarm.repeat}`, `DURATION:${alarm.duration}`);
  }
  if (alarm.action === "DISPLAY" || alarm.action === "EMAIL")
    requireIcs(alarm.description !== undefined, "alarm needs DESCRIPTION");
  if (alarm.action === "EMAIL")
    requireIcs(
      alarm.summary !== undefined && alarm.attendees?.length,
      "email alarm needs SUMMARY and ATTENDEE",
    );
  if (alarm.description !== undefined) lines.push(`DESCRIPTION:${escapeText(alarm.description)}`);
  if (alarm.summary !== undefined) lines.push(`SUMMARY:${escapeText(alarm.summary)}`);
  for (const attendee of alarm.attendees ?? []) {
    uri(attendee);
    lines.push(`ATTENDEE:${attendee}`);
  }
  if (alarm.attachment !== undefined) {
    uri(alarm.attachment);
    lines.push(`ATTACH:${alarm.attachment}`);
  }
  return [...lines, "END:VALARM"];
}

export function readAlarm(component: Component): Reminder {
  const action = one(component, "ACTION", true)?.value.toUpperCase() as Reminder["action"];
  const trigger = one(component, "TRIGGER", true) as NonNullable<ReturnType<typeof one>>;
  const alarm: Reminder = { action };
  const kind = (trigger.params.get("VALUE") ?? "DURATION").toUpperCase();
  requireIcs(kind === "DURATION" || kind === "DATE-TIME", "unsupported trigger type");
  if (kind === "DATE-TIME") alarm.triggerTime = readDate(trigger).value;
  else alarm.triggerOffset = trigger.value;
  const related = trigger.params.get("RELATED");
  if (related !== undefined) alarm.related = related.toUpperCase() as Reminder["related"] & string;
  for (const [name, key] of [
    ["DESCRIPTION", "description"],
    ["SUMMARY", "summary"],
  ] as const) {
    const prop = one(component, name);
    if (prop) alarm[key] = unescapeText(prop.value);
  }
  const repeat = one(component, "REPEAT");
  if (repeat) {
    requireIcs(/^\d+$/.test(repeat.value), "invalid REPEAT");
    alarm.repeat = Number(repeat.value);
  }
  const interval = one(component, "DURATION");
  if (interval) alarm.duration = interval.value;
  const attendees = all(component, "ATTENDEE");
  if (attendees.length) alarm.attendees = attendees.map((prop) => prop.value);
  const attachment = one(component, "ATTACH");
  if (attachment) {
    requireIcs(
      (attachment.params.get("VALUE") ?? "URI").toUpperCase() === "URI",
      "binary alarm attachment unsupported",
    );
    alarm.attachment = attachment.value;
  }
  alarmLines(alarm);
  return alarm;
}
