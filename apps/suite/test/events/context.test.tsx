// AUTHORED-BY Codex (GPT-6.1 Sol)
import { expect, it, vi } from "vitest";
import { ensureEventsSample } from "../../src/apps/events/demo/sample";
import { EventsProvider, useEvents } from "../../src/apps/events/state/events-context";
import { createDemoPod } from "../../src/lib/demo-pod/pod";
import type { PodSession } from "../../src/lib/session/pod-session";
import { act, click, h, mount } from "../drive-ui-dom";

vi.mock("../../src/apps/events/demo/sample", () => ({
  ensureEventsSample: vi.fn().mockResolvedValue(undefined),
}));
const root = "https://events.context.test/";
function fixture() {
  const pod = createDemoPod({ root });
  const session: PodSession = {
    mode: "demo",
    webId: `${root}profile#me`,
    storageUrl: root,
    displayName: "Cleo Wren",
    fetch: pod.fetch,
    subscribe: pod.subscribe,
    reset: async () => {},
  };
  return session;
}
let value: ReturnType<typeof useEvents>;
function Probe() {
  value = useEvents();
  return h("p", null, value.loading ? "Opening" : "Ready");
}
it("owns an account controller, refreshes on online/subscription and fences it after unmount", async () => {
  vi.mocked(ensureEventsSample).mockResolvedValue(undefined);
  const session = fixture();
  const view = await mount(h(EventsProvider, { session, children: h(Probe) }));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.textContent).toBe("Ready");
  });
  expect(value.events).toEqual([]);
  const refresh = vi.spyOn(value.controller, "refresh");
  await act(() => {
    window.dispatchEvent(new Event("online"));
  });
  expect(refresh).toHaveBeenCalled();
  const controller = value.controller;
  await view.unmount();
  const before = controller.snapshot();
  await controller.refresh();
  expect(controller.snapshot()).toBe(before);
});
it("offers retry when demo initialisation fails", async () => {
  vi.mocked(ensureEventsSample)
    .mockRejectedValueOnce(new Error("storage unavailable"))
    .mockResolvedValue(undefined);
  const view = await mount(h(EventsProvider, { session: fixture(), children: h(Probe) }));
  await vi.waitFor(() => expect(view.host.textContent).toContain("Couldn't prepare"));
  const retry = view.host.querySelector("button");
  if (!retry) throw new Error("Missing retry button");
  await click(retry);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.textContent).toBe("Ready");
  });
});
it("requires its context", async () => {
  await expect(mount(h(Probe))).rejects.toThrow("EventsProvider is required");
});

it("retries repeated initialisation failures before recovering", async () => {
  vi.mocked(ensureEventsSample)
    .mockRejectedValueOnce(new Error("first"))
    .mockRejectedValueOnce(new Error("second"))
    .mockResolvedValue(undefined);
  const view = await mount(h(EventsProvider, { session: fixture(), children: h(Probe) }));
  await vi.waitFor(() => expect(view.host.textContent).toContain("Couldn't prepare"));
  await click(view.host.querySelector("button") as HTMLButtonElement);
  await vi.waitFor(() => expect(ensureEventsSample).toHaveBeenCalled());
  expect(view.host.textContent).toContain("Couldn't prepare");
  await click(view.host.querySelector("button") as HTMLButtonElement);
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.textContent).toBe("Ready");
  });
});

it.each(["resolve", "reject"] as const)("fences initial seed %s after unmount", async (outcome) => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  vi.mocked(ensureEventsSample).mockReturnValueOnce(pending);
  const view = await mount(h(EventsProvider, { session: fixture(), children: h(Probe) }));
  const controller = value.controller;
  const refresh = vi.spyOn(controller, "refresh");
  await view.unmount();
  await act(async () => {
    if (outcome === "resolve") resolve();
    else reject(new Error("late seed"));
  });
  expect(refresh).not.toHaveBeenCalled();
});

it.each(["resolve", "reject"] as const)("fences a seed retry %s after unmount", async (outcome) => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const pending = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  vi.mocked(ensureEventsSample)
    .mockRejectedValueOnce(new Error("initial"))
    .mockReturnValueOnce(pending);
  const view = await mount(h(EventsProvider, { session: fixture(), children: h(Probe) }));
  await vi.waitFor(() => expect(view.host.textContent).toContain("Couldn't prepare"));
  await click(view.host.querySelector("button") as HTMLButtonElement);
  const controller = value.controller;
  const refresh = vi.spyOn(controller, "refresh");
  await view.unmount();
  await act(async () => {
    if (outcome === "resolve") resolve();
    else reject(new Error("late retry"));
  });
  expect(refresh).not.toHaveBeenCalled();
});

it("suppresses subscription refresh during saves, reports a failed write, and changes accounts safely", async () => {
  vi.mocked(ensureEventsSample).mockResolvedValue(undefined);
  let invalidate = () => {};
  const session = {
    ...fixture(),
    subscribe: (listener: (url: string) => void) => {
      invalidate = () => listener(root);
      return () => {};
    },
  };
  const view = await mount(h(EventsProvider, { session, children: h(Probe) }));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.textContent).toBe("Ready");
  });
  let reject!: (error: Error) => void;
  const pending = new Promise<never>((_yes, no) => {
    reject = no;
  });
  vi.spyOn(value.controller.repository, "create").mockReturnValueOnce(pending);
  const refresh = vi.spyOn(value.controller, "refresh");
  const failure = vi.spyOn((await import("@jeswr/suite-ui")).toast, "error");
  const { EVENT_STATUS } = await import("@jeswr/solid-events");
  await act(() => {
    value.controller.save({
      name: "New",
      startDate: new Date(),
      organizer: session.webId,
      eventStatus: EVENT_STATUS.scheduled,
      visibility: "link",
      guestListVisible: false,
      publication: "published",
      created: new Date(),
      modified: new Date(),
    });
    invalidate();
  });
  expect(refresh).not.toHaveBeenCalled();
  await act(async () => {
    reject(new Error("write failed"));
    await value.controller.settled();
  });
  expect(failure).toHaveBeenCalled();
  const liveSession: PodSession = {
    ...session,
    mode: "solid",
    publicFetch: session.fetch,
    webId: `${root}new-account#me`,
  };
  await view.render(h(EventsProvider, { session: liveSession, children: h(Probe) }));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(value.session.webId).toBe(liveSession.webId);
    expect(view.host.textContent).toBe("Ready");
  });
});

it("reports unreadable invitations while still showing the readable ones", async () => {
  vi.mocked(ensureEventsSample).mockResolvedValue(undefined);
  const session = fixture();
  const view = await mount(h(EventsProvider, { session, children: h(Probe) }));
  await vi.waitFor(async () => {
    await act(async () => {});
    expect(view.host.textContent).toBe("Ready");
  });
  const failure = vi.spyOn((await import("@jeswr/suite-ui")).toast, "error");
  const broken = new URL("broken/index.ttl", value.controller.repository.base).href;
  const put = await session.fetch(broken, {
    method: "PUT",
    headers: { "content-type": "text/turtle" },
    body: "this is not turtle <",
  });
  expect(put.ok).toBe(true);
  await act(async () => {
    await value.controller.refresh();
  });
  expect(failure).toHaveBeenCalledWith(
    "Some invitations could not be loaded. The available invitations are shown.",
  );
  expect(value.events).toEqual([]);
  failure.mockRestore();
  await view.unmount();
});
