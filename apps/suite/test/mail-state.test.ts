// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// biome-ignore-all lint/style/noNonNullAssertion: Fixture assertions establish thread identities.
import { expect, it, vi } from "vitest";
import { folderIriFromKey, MailClient, type ThreadPage } from "../src/apps/mail/lib/client";
import { documentOf, MailError } from "../src/apps/mail/lib/model";
import {
  MailProvider,
  useMail,
  useMailActions,
  useThreads,
} from "../src/apps/mail/state/mail-context";
import { createDemoPod } from "../src/lib/demo-pod/pod";
import type { PodSession } from "../src/lib/session/pod-session";
import { act, deferred, h, mount } from "./drive-ui-dom";
import { mailboxChunks } from "./fixtures/mail-mbox";

const notices = vi.hoisted(() => ({ error: vi.fn(), toast: vi.fn() }));
vi.mock("@jeswr/suite-ui", () => ({
  toast: Object.assign(notices.toast, { error: notices.error }),
}));
let context: ReturnType<typeof useMail>;
let threads: ReturnType<typeof useThreads>;
let actions: ReturnType<typeof useMailActions>;
function Probe({ pageSize = 50 }: { pageSize?: number }) {
  context = useMail();
  threads = useThreads("inbox", pageSize);
  actions = useMailActions();
  return null;
}
async function settle(predicate: () => boolean) {
  for (let attempt = 0; attempt < 100; attempt++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (predicate()) return;
  }
  throw new Error("Mail hook did not settle");
}
async function setup(count = 1, pageSize = 50) {
  notices.error.mockClear();
  notices.toast.mockClear();
  localStorage.clear();
  const pod = createDemoPod({ root: "https://mail.example/" });
  const writer = new MailClient(pod.fetch, pod.root);
  await writer.importMailbox("imported", mailboxChunks(count));
  const session: PodSession = {
    mode: "demo",
    webId: `${pod.root}profile/card#me`,
    displayName: "Reader",
    storageUrl: pod.root,
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  const view = await mount(h(MailProvider, { session, children: h(Probe, { pageSize }) }));
  await settle(
    () =>
      threads.status === "ready" &&
      threads.data?.items.length === Math.min(Math.ceil(count / 5), pageSize),
  );
  return { view, pod, writer };
}
it("ignores stale folder responses after an account switch, and persists the choice", async () => {
  const { view } = await setup();
  const first = deferred<ThreadPage>();
  const second = deferred<ThreadPage>();
  vi.spyOn(context.client, "threads").mockImplementation((account) =>
    account === "first" ? first.promise : second.promise,
  );
  await act(() => context.setAccount("first"));
  await act(() => context.setAccount("second"));
  expect(threads.data).toBeUndefined();
  const page = { items: [], next: null, total: 0 };
  await act(() => second.resolve(page));
  expect(threads.data).toEqual(page);
  await act(() => first.resolve({ ...page, total: 99 }));
  expect(threads.data?.total).toBe(0);
  expect(localStorage.getItem("suite.mail.account")).toBe("second");
  await view.unmount();
  vi.restoreAllMocks();
});
it("keeps a newer star intention visible when an earlier conditional write fails", async () => {
  const { view } = await setup();
  const firstWrite = deferred<void>();
  const nextWrite = deferred<void>();
  const persist = vi
    .spyOn(context.client, "star")
    .mockImplementationOnce(() => firstWrite.promise)
    .mockImplementationOnce(() => nextWrite.promise);
  const row = threads.data!.items[0]!;
  expect(row.starred).toBe(true);
  let first = Promise.resolve<boolean[]>([]);
  let next = Promise.resolve<boolean[]>([]);
  await act(() => {
    first = actions.forRows([row], "star", false);
  });
  expect(threads.data!.items[0]!.starred).toBe(false);
  await act(() => {
    next = actions.forRows([row], "star", true);
  });
  expect(threads.data!.items[0]!.starred).toBe(true);
  await act(() => firstWrite.reject(new Error("conditional write failed")));
  await settle(() => persist.mock.calls.length === 2);
  expect(threads.data!.items[0]!.starred).toBe(true);
  await act(async () => {
    nextWrite.resolve();
    await first;
    await next;
  });
  await settle(() => threads.status === "ready");
  expect(threads.data!.items[0]!.starred).toBe(true);
  expect(notices.error).toHaveBeenCalledTimes(1);
  await view.unmount();
  vi.restoreAllMocks();
});
it("archives optimistically and Undo restores real Inbox membership", async () => {
  const { view, writer } = await setup();
  const row = threads.data!.items[0]!;
  let done = Promise.resolve<boolean[]>([]);
  await act(() => {
    done = actions.forRows([row], "archive");
  });
  expect(threads.data?.items).toEqual([]);
  await act(async () => {
    await done;
  });
  await settle(() => threads.status === "ready" && threads.data?.items.length === 0);
  const [, options] = notices.toast.mock.calls.at(-1)! as [
    string,
    { action: { onClick: () => void } },
  ];
  await act(() => options.action.onClick());
  await settle(() => threads.status === "ready" && threads.data?.items.length === 1);
  expect(
    (await writer.threads("imported", folderIriFromKey(writer.root("imported"), "archive"))).total,
  ).toBe(0);
  await view.unmount();
});

it.each([
  ["reader", "archive"],
  ["reader", "message"],
  ["reader", "inbox"],
  ["list", "archive"],
  ["list", "message"],
  ["list", "inbox"],
])("%s retains Undo after repeated conflicts on the %s document, including partial writes", async (entry, failing) => {
  const { view, writer } = await setup();
  const row = threads.data!.items[0]!;
  const message = (await writer.thread(row.iri)).messages[0]!;
  const inbox = folderIriFromKey(writer.root("imported"), "inbox");
  const archive = folderIriFromKey(writer.root("imported"), "archive");
  for (const label of message.labels)
    if (label !== inbox) await writer.label(message.iri, label, false);
  const save = context.client.store.save.bind(context.client.store);
  const failureUrl = documentOf(
    failing === "archive" ? archive : failing === "message" ? message.iri : inbox,
  );
  const failure = vi
    .spyOn(context.client.store, "save")
    .mockImplementation((doc, dataset) =>
      doc.url === failureUrl ? Promise.reject(new MailError("conflict", 412)) : save(doc, dataset),
    );
  await act(async () => {
    if (entry === "reader") await actions.archive([message.iri], row.iri);
    else await actions.forRows([row], "archive");
  });
  expect(notices.error).toHaveBeenCalledOnce();
  expect((await writer.thread(row.iri)).messages[0]?.labels).toEqual([
    failing === "inbox" ? archive : inbox,
  ]);
  expect((await writer.threads("imported", archive)).total).toBe(failing === "archive" ? 0 : 1);
  expect(await writer.search("imported", "Garden")).toHaveLength(1);
  const [text, options] = notices.toast.mock.calls.at(-1)! as [
    string,
    { action: { onClick: () => void } },
  ];
  expect(text).toBe("Archive incomplete");
  failure.mockRestore();
  await act(() => options.action.onClick());
  await settle(() => !context.patches.some((patch) => patch.confirmedAt === undefined));
  expect((await writer.thread(row.iri)).messages[0]?.labels).toEqual([inbox]);
  expect((await writer.threads("imported", inbox)).total).toBe(1);
  expect((await writer.threads("imported", archive)).total).toBe(0);
  await view.unmount();
});

it("keeps existing rows visible while loading another page", async () => {
  const { writer, view } = await setup(6, 1);
  const page = deferred<ThreadPage>();
  vi.spyOn(context.client, "threads").mockImplementation(() => page.promise);
  await act(() => threads.loadMore());
  expect(threads.status).toBe("loading");
  expect(threads.data?.items).toHaveLength(1);
  const expanded = await writer.threads(
    "imported",
    folderIriFromKey(writer.root("imported"), "inbox"),
    0,
    2,
  );
  await act(() => page.resolve(expanded));
  expect(threads.data?.items).toHaveLength(2);
  await view.unmount();
  vi.restoreAllMocks();
});

it.each([
  "reader",
  "list",
] as const)("%s Archive Undo preserves every original membership in a mixed thread", async (entry) => {
  const { view, writer } = await setup(4);
  const row = threads.data!.items[0]!;
  const ids = (await writer.thread(row.iri)).messages.map((message) => message.iri);
  const inbox = folderIriFromKey(writer.root("imported"), "inbox");
  await writer.archive([ids[0]!, ids[1]!]);
  await writer.label(ids[0]!, inbox, true); // Already in Archive AND Inbox.
  await writer.label(ids[2]!, inbox, false); // Never in either system folder.
  const before = (await writer.thread(row.iri)).messages.map((message) =>
    [...message.labels].sort(),
  );
  notices.toast.mockClear();
  await act(async () => {
    if (entry === "reader") await actions.archive(ids, row.iri);
    else await actions.forRows([row], "archive");
  });
  const [, options] = notices.toast.mock.calls.at(-1)! as [
    string,
    { action: { onClick: () => void } },
  ];
  await act(() => options.action.onClick());
  await settle(() => !context.patches.some((patch) => patch.confirmedAt === undefined));
  expect(
    (await writer.thread(row.iri)).messages.map((message) => [...message.labels].sort()),
  ).toEqual(before);
  await view.unmount();
});

it.each([
  "reader",
  "list",
] as const)("%s suppresses Undo and archive writes for already archived mail", async (entry) => {
  const { view, writer } = await setup();
  const row = threads.data!.items[0]!;
  const ids = (await writer.thread(row.iri)).messages.map((message) => message.iri);
  await writer.archive(ids);
  const archive = vi.spyOn(context.client, "archive");
  notices.toast.mockClear();
  await act(async () => {
    if (entry === "reader") await actions.archive(ids, row.iri);
    else await actions.forRows([row], "archive");
  });
  expect(archive).not.toHaveBeenCalled();
  expect(notices.toast).not.toHaveBeenCalled();
  expect((await writer.thread(row.iri)).messages[0]?.labels).not.toContain(
    folderIriFromKey(writer.root("imported"), "inbox"),
  );
  await view.unmount();
  vi.restoreAllMocks();
});
