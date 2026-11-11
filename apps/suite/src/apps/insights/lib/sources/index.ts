// AUTHORED-BY Codex (GPT-6.1 Sol)
import { calendarDay, type Series, shiftDay } from "@jeswr/suite-insights";
import type { PodSession } from "@/lib/session/pod-session";
import { readCalendarEvents } from "../../sources/adapters/calendar";
import { readHealthMeasurements } from "../../sources/adapters/health";
import { readMoneyTransactions } from "../../sources/adapters/money";
import { readMusicHistory } from "../../sources/adapters/music";
import { readCompletedTasks } from "../../sources/adapters/tasks";

export interface Source {
  id: string;
  label: string;
  status: "found" | "empty" | "error" | "unavailable";
  days: number;
  series: Series[];
  message?: string;
  droppedPoints?: number;
}
export interface SourceContext {
  session: PodSession;
  now: Date;
  timeZone: string;
}
export interface SourceAdapter {
  id: string;
  label: string;
  read(context: SourceContext): Promise<Series[]>;
}
function bounds(now: Date) {
  const end = new Date(now);
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 150);
  return { start, end };
}
export const healthSource: SourceAdapter = {
  id: "health",
  label: "Health",
  async read({ session, now }) {
    const rows = await readHealthMeasurements(session, bounds(now));
    return (
      [
        ["steps", "Steps", "steps", "sum", 1],
        ["sleep", "Sleep", "min", "sum", 1 / 60],
        ["heartRate", "Heart rate", "bpm", "mean", 1],
        ["weight", "Weight", "kg", "last", 1],
      ] as const
    ).map(([kind, label, unit, aggregation, factor]) => ({
      id: `health.${kind}`,
      label,
      unit,
      aggregation,
      points: rows
        .filter((p) => p.kind === kind)
        .map((p) => ({ at: p.at, value: p.value * factor })),
    }));
  },
};
export const moneySource: SourceAdapter = {
  id: "money",
  label: "Money",
  async read({ session, now }) {
    const rows = (await readMoneyTransactions(session, bounds(now))).filter(
      (r) => !r.debitAccount && !r.creditAccount,
    );
    const currencies = [...new Set(rows.map((r) => r.currency))].sort();
    return currencies.map((currency) => ({
      id: `money.spending.${currency}`,
      label: `Spending (${currency})`,
      unit: currency,
      aggregation: "sum",
      // Keep currencies separate. Income and transfer legs are never counted as spending.
      points: rows
        .filter((r) => r.currency === currency && Number(r.amount) < 0)
        .map((r) => ({ at: r.postingTime, value: -Number(r.amount) })),
    }));
  },
};
export const musicSource: SourceAdapter = {
  id: "music",
  label: "Music",
  async read({ session, now }) {
    const rows = await readMusicHistory(session, bounds(now));
    return [
      {
        id: "music.listens",
        label: "Music listens",
        unit: "plays",
        aggregation: "sum",
        points: rows.map((r) => ({ at: r.startTime, value: 1 })),
      },
    ];
  },
};
export const tasksSource: SourceAdapter = {
  id: "tasks",
  label: "Tasks",
  async read({ session }) {
    const points = await readCompletedTasks(session);
    return [
      {
        id: "tasks.completed",
        label: "Tasks completed",
        unit: "tasks",
        aggregation: "sum",
        points,
      },
    ];
  },
};
export const calendarSource: SourceAdapter = {
  id: "calendar",
  label: "Calendar",
  async read({ session, now, timeZone }) {
    const events = await readCalendarEvents(session, bounds(now), timeZone);
    return [
      {
        id: "calendar.events",
        label: "Calendar events",
        unit: "events",
        aggregation: "sum",
        points: events.map((e) => ({ at: e.data.start, value: 1 })),
      },
    ];
  },
};
export const adapters = [healthSource, moneySource, musicSource, tasksSource, calendarSource];
/** Each source fails independently; denied data is never presented as an empty source. */
export async function loadSources(
  context: SourceContext,
  readers: readonly SourceAdapter[] = adapters,
): Promise<Source[]> {
  const end = calendarDay(context.now, context.timeZone);
  const start = shiftDay(end, -149);
  const sources = await Promise.all(
    readers.map(async (reader): Promise<Source> => {
      try {
        let droppedPoints = 0;
        const days = new Set<string>();
        const series = (await reader.read(context)).map((s) => ({
          ...s,
          points: s.points.filter((p) => {
            let day: string;
            try {
              day = calendarDay(p.at, context.timeZone);
            } catch {
              droppedPoints++;
              return false;
            }
            if (!Number.isFinite(p.value)) {
              droppedPoints++;
              return false;
            }
            if (day < start || day > end) return false;
            days.add(day);
            return true;
          }),
        }));
        return {
          id: reader.id,
          label: reader.label,
          status: days.size ? "found" : "empty",
          days: days.size,
          droppedPoints,
          series,
        };
      } catch {
        return {
          id: reader.id,
          label: reader.label,
          status: "error",
          days: 0,
          series: [],
          message: "Could not read this source. Check your connection and access, then refresh.",
        };
      }
    }),
  );
  return [
    ...sources,
    {
      id: "journal",
      label: "Journal mood",
      status: "unavailable",
      days: 0,
      series: [],
      message: "Journal mood isn’t available yet.",
    },
  ];
}
