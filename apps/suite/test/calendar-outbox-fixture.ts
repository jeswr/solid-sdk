// AUTHORED-BY Codex GPT-6.1-Sol
import { createRequire } from "node:module";
import { createMemoryStorage } from "@jeswr/storage-client/memory";
import {
  createOutbox,
  type IntentSession,
  type Outbox,
  withOutbox,
} from "@jeswr/suite-sdk/offline";
import { afterEach, vi } from "vitest";
import { CalendarHttpError, calendarIO } from "../src/apps/calendar/lib/model";
import { eventDocument } from "../src/apps/calendar/state/editing";
import type { OutboxStorage } from "../src/apps/calendar/state/event-write";
import type { SeriesRecovery } from "../src/apps/calendar/state/intents";
import { createEventOutbox } from "../src/apps/calendar/state/outbox";
import { type EventWrite, eventMutations } from "../src/apps/calendar/state/repository";
import { createDemoPod } from "../src/lib/demo-pod/pod";

const { IDBFactory } = createRequire(
  new URL("../../../packages/solid-offline/package.json", import.meta.url),
)("fake-indexeddb") as { IDBFactory: new () => IDBFactory };
export const root = "https://pod.example/";
export const webId = `${root}profile#me`;
export const url = `${root}calendar/work/e.ttl`;
export const data = {
  name: "2026-11-01T12:00:00Z",
  start: new Date("2026-11-01T12:00Z"),
  end: new Date("2026-11-01T13:00Z"),
  timeZone: "America/New_York",
  recurrence: {
    frequency: "WEEKLY" as const,
    until: new Date("2026-12-01"),
    exceptDate: [new Date("2026-11-08T12:00Z"), "2026-11-15"],
  },
  reminders: [{ triggerOffset: "-PT5M" }, { triggerTime: new Date("2026-11-01T11:30Z") }],
};
export const write = { kind: "create", url, data } satisfies EventWrite;
export const calendars = [
  {
    url: `${root}calendar/work.ttl`,
    title: "Work",
    colour: "",
    container: `${root}calendar/work/`,
    etag: null,
  },
];
const boxes: Outbox[] = [];
const cleanups: Array<() => void> = [];
export function legacyStorage(): OutboxStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}
export function fixture(
  options: {
    idb?: IDBFactory;
    legacy?: OutboxStorage;
    demo?: boolean;
    webId?: string;
    allowed?: (write: EventWrite) => void;
    recovery?: SeriesRecovery;
    conflict?: (error: CalendarHttpError) => void;
  } = {},
) {
  const identity = options.webId ?? webId;
  const idb = options.idb ?? new IDBFactory();
  const outbox = createOutbox({ webId: identity, idb });
  boxes.push(outbox);
  const raw = createMemoryStorage({ root, protocol: "solid" });
  const storage = withOutbox(raw, outbox);
  const pod = createDemoPod({ root, seed: [] });
  const transport = vi.fn<typeof fetch>((input, init) => pod.fetch(input, init));
  const controller = new AbortController();
  const changed = vi.fn();
  const failed = vi.fn();
  const invalidate = vi.fn();
  const send = vi.fn(
    eventMutations(
      { webId: identity, storageUrl: root, fetch: transport },
      vi.fn(),
      invalidate,
      failed,
    ),
  );
  const legacy = options.legacy ?? legacyStorage();
  const allowed =
    options.allowed ??
    ((item: EventWrite) => {
      eventDocument(item.url, root, calendars);
    });
  const adapter = createEventOutbox(identity, legacy, send, changed, allowed, options.recovery, {
    demo: options.demo ?? false,
    storageUrl: root,
    calendars: () => calendars,
    ...(options.conflict ? { conflict: options.conflict } : {}),
  });
  const context = { fetch: transport, webId: identity, storage: raw, signal: controller.signal };
  const session: IntentSession = {
    registerGuardPolicy: outbox.registerGuardPolicy,
    registerReplayDelegate: (tag, factory) => outbox.registerDelegate(tag, factory(context)),
  };
  const register = () => {
    const cleanup = adapter.channel.register(session);
    cleanups.push(cleanup);
    return cleanup;
  };
  const connect = () => {
    const cleanup = adapter.connect({ outbox, storage, signal: controller.signal });
    cleanups.push(cleanup);
    return cleanup;
  };
  const io = calendarIO(pod.fetch, root);
  return {
    idb,
    outbox,
    raw,
    storage,
    pod,
    transport,
    controller,
    changed,
    failed,
    invalidate,
    send,
    legacy,
    adapter,
    register,
    connect,
    io,
    context,
    session,
  };
}
afterEach(() => {
  for (const stop of cleanups.splice(0)) stop();
  for (const box of boxes.splice(0)) box.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

export { CalendarHttpError };
