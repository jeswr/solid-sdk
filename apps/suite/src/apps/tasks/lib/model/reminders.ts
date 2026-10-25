// AUTHORED-BY Codex GPT-6.1-Sol
import { TermFrom } from "@rdfjs/wrapper";
import { aliases, type Node, NS, requireDate, SCHED } from "./rdf";

export type Reminder =
  | { id?: string | undefined; offset: string; time?: never }
  | { id?: string | undefined; time: Date; offset?: never };
/** Fixed ISO day/time durations only: months/years have no fixed reminder offset. */
export function offsetMilliseconds(value: string): number {
  const match =
    /^(-)?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );
  if (!match?.slice(2).some(Boolean) || value.endsWith("T"))
    throw new TypeError("Expected a day/time duration.");
  return (
    (match[1] ? -1 : 1) *
    (Number(match[2] ?? 0) * 86400 +
      Number(match[3] ?? 0) * 3600 +
      Number(match[4] ?? 0) * 60 +
      Number(match[5] ?? 0)) *
    1000
  );
}
export function validateReminders(reminders: readonly Reminder[], due: Date | undefined): void {
  if (reminders.length && !due) throw new TypeError("Reminders require a due date.");
  for (const reminder of reminders) {
    if ((reminder.offset !== undefined) === (reminder.time !== undefined))
      throw new TypeError("A reminder requires exactly one trigger.");
    if (reminder.offset !== undefined) offsetMilliseconds(reminder.offset);
    else requireDate(reminder.time as Date);
  }
}
export function readReminders(task: Node): Reminder[] {
  return aliases(`${SCHED}hasReminder`)
    .flatMap((p) => [...task.nodes(p)])
    .map((value, index) => {
      const id = value.termType === "NamedNode" ? value.value : `${task.value}/reminder-${index}`;
      const offset = value.text(`${SCHED}triggerOffset`);
      const time = value.date(`${SCHED}triggerTime`);
      if ((offset !== undefined) === (time !== undefined))
        throw new TypeError("A reminder requires exactly one trigger.");
      return offset === undefined ? { id, time: time as Date } : { id, offset };
    });
}
export function writeReminders(
  task: Node,
  reminders: readonly Reminder[],
  due: Date | undefined,
): void {
  validateReminders(reminders, due);
  for (const p of aliases(`${SCHED}hasReminder`))
    for (const old of task.nodes(p)) {
      for (const q of [...old.dataset.match(TermFrom.instance(old, old.factory))])
        old.dataset.delete(q);
    }
  task.clear(`${SCHED}hasReminder`);
  for (const reminder of reminders) {
    const value = task.child();
    value.types.add(`${SCHED}Reminder`);
    value.setTyped(`${SCHED}triggerOffset`, reminder.offset, `${NS.XSD}duration`);
    value.setDate(`${SCHED}triggerTime`, reminder.time);
    task.nodes(`${SCHED}hasReminder`).add(value);
  }
}
export interface FireTime {
  id: string;
  at: Date;
  key: string;
}
/** The scheduler persists these keys; no browser storage or notification side effects here. */
export function computeFireTimes(
  taskId: string,
  due: Date | undefined,
  reminders: readonly Reminder[],
): FireTime[] {
  validateReminders(reminders, due);
  return reminders.map((reminder, index) => {
    const id = reminder.id ?? `${taskId}/reminder-${index}`;
    const at =
      reminder.time ??
      new Date((due as Date).getTime() + offsetMilliseconds(reminder.offset as string));
    return { id, at, key: `${id}@${at.toISOString()}` };
  });
}
export function pendingReminders(
  times: readonly FireTime[],
  now: Date,
  fired: ReadonlySet<string>,
): FireTime[] {
  return times.filter((time) => time.at <= now && !fired.has(time.key));
}
export function shiftReminders(reminders: readonly Reminder[], delta: number): Reminder[] {
  return reminders.map((reminder) =>
    reminder.time
      ? { ...reminder, time: new Date(reminder.time.getTime() + delta) }
      : { ...reminder },
  );
}
