// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseTask } from "@jeswr/solid-task-model";
import { calendarDay, dailySeries, type Series, shiftDay } from "@jeswr/suite-insights";
import { discoverCalendars, loadRange } from "@/apps/calendar/state/repository";
import { loadMeasurements } from "@/apps/health/lib/data/metrics";
import { createHealthDataStore } from "@/apps/health/lib/data/store";
import { allTransactions } from "@/apps/money/lib/data/ledger";
import { loadHistory } from "@/apps/music/lib/model/io";
import { ModelError } from "@/apps/tasks/lib/model/errors";
import { TaskStore } from "@/apps/tasks/lib/model/store";
import type { PodSession } from "@/lib/session/pod-session";

export interface Source {
  id: string;
  label: string;
  status: "found" | "empty" | "error" | "unavailable";
  days: number;
  series: Series[];
  message?: string;
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
    const rows = await loadMeasurements(
      createHealthDataStore(session.fetch, session.storageUrl, session.webId),
      bounds(now),
    );
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
  async read({ session }) {
    const rows = (await allTransactions(session)).filter(
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
    const { start, end } = bounds(now);
    const months: Date[] = [];
    for (
      let at = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
      at <= end;
      at = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1))
    )
      months.push(at);
    const rows = await loadHistory(
      session.fetch,
      new URL("music/", session.storageUrl).href,
      months,
    );
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
    const store = new TaskStore({
      fetch: session.fetch,
      storage: session.storageUrl,
      webId: session.webId,
    });
    const projects = await store
      .listProjects(undefined, { strict: true })
      .catch((error: unknown) => {
        if (
          error instanceof ModelError &&
          [404, 410].includes(error.status) &&
          error.url === store.projects
        )
          return [];
        throw error;
      });
    const points: Series["points"][number][] = [];
    const seen = new Set<string>();
    for (const project of projects) {
      const container = project.tracker.stateStore;
      if (!container) continue;
      for (const item of await store.listTasks(container, { strict: true })) {
        if (seen.has(item.url)) continue;
        seen.add(item.url);
        const task = parseTask(item.url, item.dataset);
        if (task?.state === "closed" && task.endedAt) points.push({ at: task.endedAt, value: 1 });
      }
    }
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
    const discovery = await discoverCalendars(session);
    if (discovery.warnings.length) throw new Error("Some calendars could not be read");
    const { start, end } = bounds(now);
    const result = await loadRange(session, discovery.calendars, start, end, timeZone);
    if (result.warnings.length) throw new Error("Some calendar events could not be read");
    return [
      {
        id: "calendar.events",
        label: "Calendar events",
        unit: "events",
        aggregation: "sum",
        points: result.events.map((e) => ({ at: e.data.start, value: 1 })),
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
        const series = (await reader.read(context)).map((s) => ({
          ...s,
          points: s.points.filter((p) => {
            const day = calendarDay(p.at, context.timeZone);
            return Number.isFinite(p.value) && day >= start && day <= end;
          }),
        }));
        const days = new Set(
          series.flatMap((s) =>
            dailySeries(s.points, context.timeZone, s.aggregation).map((p) => p.day),
          ),
        ).size;
        return {
          id: reader.id,
          label: reader.label,
          status: days ? "found" : "empty",
          days,
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
