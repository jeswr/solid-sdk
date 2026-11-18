// AUTHORED-BY Codex GPT-6.1-Sol
import { createInboxReader } from "@jeswr/pod-access/notify";
import type { AuthEvent, AuthEventType, Identity, PodAuth } from "@jeswr/pod-auth";
import { PodAuthProvider } from "@jeswr/pod-auth/react";
import {
  act,
  type ComponentType,
  createElement,
  StrictMode,
  Suspense,
  startTransition,
  useLayoutEffect,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import {
  assignmentAnnounce,
  mentionNotification,
  type NotifyAction,
  type NotifyOptions,
  roomInvitation,
  shareNotification,
  useNotify,
} from "./index.js";
import { createNotify } from "./testing.js";

async function sent(body: BodyInit | null | undefined) {
  const reader = createInboxReader({
    fetch: async (url) =>
      new Response(
        url === inbox
          ? "<https://8.8.4.4/inbox/> <http://www.w3.org/ns/ldp#contains> <https://8.8.4.4/inbox/n>."
          : String(body),
        { headers: { "content-type": "text/turtle" } },
      ),
  });
  const [{ url: _url, ...activity }] = await reader.list(inbox);
  return activity;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const recipient = "https://8.8.8.8/profile#me";
const inbox = "https://8.8.4.4/inbox/";
const alice: Identity = {
  webId: "https://alice.example/#me",
  issuer: "https://op.example/",
  subject: "alice",
  clientId: "https://app.example/",
  protocol: "solid-oidc",
  storages: [],
};

function fakeAuth(current: Identity | null = alice) {
  const handlers = new Map<AuthEventType, (event: AuthEvent) => void>();
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(async (_input, init) =>
    init?.method === "POST"
      ? new Response(null, { status: 201 })
      : new Response(`<${recipient}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`, {
          headers: { "content-type": "text/turtle" },
        }),
  );
  const auth: PodAuth = {
    fetch,
    restore: async () => current,
    identity: async () => current,
    remembered: async () => [],
    login: async () => alice,
    logout: async () => {},
    on: (type, handler) => {
      handlers.set(type, handler);
      return () => {
        handlers.delete(type);
      };
    },
  };
  return {
    auth,
    fetch,
    emit: async (type: AuthEventType, identity: Identity | null) => {
      current = identity;
      await act(async () => handlers.get(type)?.({ type, identity, timestamp: 0 }));
    },
  };
}

let action: NotifyAction;
let root: Root | undefined;
let options: Omit<NotifyOptions, "fetch" | "webId"> | undefined;
let update = () => {};
function Probe() {
  action = useNotify(options);
  return null;
}
async function mount(auth: PodAuth, ProbeComponent: ComponentType = Probe) {
  const container = document.createElement("div");
  document.body.append(container);
  const mountedRoot = createRoot(container);
  root = mountedRoot;
  update = () =>
    mountedRoot.render(
      createElement(
        StrictMode,
        null,
        createElement(
          PodAuthProvider,
          { auth },
          createElement(Suspense, { fallback: "loading" }, createElement(ProbeComponent)),
        ),
      ),
    );
  await act(update);
}
afterEach(async () => {
  const mountedRoot = root;
  if (mountedRoot) await act(() => mountedRoot.unmount());
  root = undefined;
  options = undefined;
  document.body.replaceChildren();
});

test("uses the real provider fetch and current actor, stays stable on rerender and caches discovery", async () => {
  const { auth, fetch } = fakeAuth();
  await mount(auth);
  const first = action;
  await act(update);
  expect(action).toBe(first);
  const draft = assignmentAnnounce(
    "https://pod.example/task#it",
    "https://pod.example/tracker#this",
    "Alice",
    "Pay rent",
  );
  expect(await action(recipient, draft)).toEqual({ delivered: true, inbox });
  expect(await action(recipient, draft)).toEqual({ delivered: true, inbox });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect(await sent(fetch.mock.calls[1]?.[1]?.body)).toEqual({
    ...draft,
    actor: alice.webId,
    published: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
  });
  expect(shareNotification("https://pod.example/doc", "reader").type).toBe("Announce");
  expect(mentionNotification("https://pod.example/comment", "https://pod.example/doc").type).toBe(
    "Create",
  );
  expect(roomInvitation("https://pod.example/room/").type).toBe("Offer");
  expect(typeof createNotify({ fetch, webId: "https://alice.example/#me" })).toBe("function");
});

test("resets the cache on account switch and same-account logout/login", async () => {
  const { auth, fetch, emit } = fakeAuth();
  await mount(auth);
  const draft = roomInvitation("https://pod.example/room/");
  await action(recipient, draft);
  const first = action;
  const bob = { ...alice, webId: "https://bob.example/#me", subject: "bob" };
  await emit("login", bob);
  expect(action).not.toBe(first);
  await action(recipient, draft);
  expect(fetch).toHaveBeenCalledTimes(4);
  expect((await sent(fetch.mock.calls[3]?.[1]?.body)).actor).toBe(bob.webId);
  await emit("logout", null);
  expect(await action(recipient, draft)).toEqual({
    delivered: false,
    inbox: null,
    reason: "unauthenticated",
  });
  expect(fetch).toHaveBeenCalledTimes(4);
  await emit("login", bob);
  await action(recipient, draft);
  expect(fetch).toHaveBeenCalledTimes(6);
});

test("refuses explicit actors when the authenticated CID identity has no WebID", async () => {
  const { auth, fetch } = fakeAuth({ ...alice, protocol: "lws", webId: null });
  await mount(auth);
  const draft = roomInvitation("https://pod.example/room/");
  expect(await action(recipient, draft)).toEqual({
    delivered: false,
    inbox: null,
    reason: "unauthenticated",
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(await action(recipient, { ...draft, actor: "https://alice.example/#me" })).toEqual({
    delivered: false,
    inbox: null,
    reason: "unauthenticated",
  });
});

test("uses recipient protocol hints without treating the LWS sender as an LWS recipient", async () => {
  const { auth, fetch } = fakeAuth({ ...alice, protocol: "lws" });
  options = { clock: () => 0, recipientProtocol: () => "solid" };
  await mount(auth);
  expect(await action(recipient, roomInvitation("https://pod.example/room/"))).toEqual({
    delivered: true,
    inbox,
  });
  options = { recipientProtocol: () => "lws" };
  await act(update);
  expect(await action(recipient, roomInvitation("https://pod.example/room/"))).toEqual({
    delivered: false,
    inbox: null,
    reason: "lws-no-ldn",
  });
  expect(fetch).toHaveBeenCalledTimes(2);
});

test("returns delivery failures and respects an explicitly pinned authenticated fetch", async () => {
  const { auth, fetch } = fakeAuth();
  options = { pinningFetch: fetch };
  await mount(auth);
  fetch.mockRejectedValueOnce(new TypeError("offline"));
  expect(await action(recipient, roomInvitation("https://pod.example/room/"))).toEqual({
    delivered: false,
    inbox: null,
    reason: "network",
  });
});

test("fences retained actions and in-flight discovery across logout and same-account login", async () => {
  const { auth, fetch, emit } = fakeAuth();
  await mount(auth);
  const oldAction = action;
  const draft = roomInvitation("https://pod.example/room/");
  const profile = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  fetch.mockImplementationOnce(async () => {
    started.resolve();
    return profile.promise;
  });
  const pending = oldAction(recipient, draft);
  await started.promise;
  await emit("logout", null);
  await emit("login", alice);
  profile.resolve(
    new Response(`<${recipient}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`, {
      headers: { "content-type": "text/turtle" },
    }),
  );
  expect(await pending).toEqual({ delivered: false, inbox, reason: "network" });
  expect(await oldAction(recipient, draft)).toEqual({ delivered: false, inbox, reason: "network" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await action(recipient, draft)).toEqual({ delivered: true, inbox });
  expect(fetch).toHaveBeenCalledTimes(3);
});

test.each([
  false,
  true,
])("revokes retained actions and pending discovery on unmount (pinned transport: %s)", async (pinned) => {
  const { auth, fetch, emit } = fakeAuth();
  if (pinned) options = { pinningFetch: fetch };
  await mount(auth);
  const oldAction = action;
  const draft = roomInvitation("https://pod.example/room/");
  const profile = Promise.withResolvers<Response>();
  const started = Promise.withResolvers<void>();
  fetch.mockImplementationOnce(async () => {
    started.resolve();
    return profile.promise;
  });
  const pending = oldAction(recipient, draft);
  await started.promise;

  await act(() => root?.unmount());
  root = undefined;
  const bob = { ...alice, webId: "https://bob.example/#me", subject: "bob" };
  await emit("login", bob);
  await mount(auth);
  profile.resolve(
    new Response(`<${recipient}> <http://www.w3.org/ns/ldp#inbox> <${inbox}>.`, {
      headers: { "content-type": "text/turtle" },
    }),
  );

  expect(await pending).toEqual({ delivered: false, inbox, reason: "network" });
  expect(await oldAction(recipient, draft)).toEqual({ delivered: false, inbox, reason: "network" });
  expect(await oldAction("https://1.1.1.1/profile#me", draft)).toEqual({
    delivered: false,
    inbox: null,
    reason: "network",
  });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(await action(recipient, draft)).toEqual({ delivered: true, inbox });
  expect(fetch).toHaveBeenCalledTimes(3);
  expect((await sent(fetch.mock.calls[2]?.[1]?.body)).actor).toBe(bob.webId);
});

test.each([
  "commit",
  "discard",
])("keeps committed actions active while an option change suspends, then %ss it", async (outcome) => {
  const { auth, fetch } = fakeAuth();
  const originalOptions = { clock: () => 0 };
  options = originalOptions;
  const blocker = Promise.withResolvers<void>();
  let suspended = false;
  let attemptedAction: NotifyAction | undefined;
  function SuspendedProbe() {
    const notify = useNotify(options);
    useLayoutEffect(() => {
      action = notify;
    }, [notify]);
    if (suspended) {
      attemptedAction = notify;
      throw blocker.promise;
    }
    return createElement("p", null, "ready");
  }
  await mount(auth, SuspendedProbe);
  const committedAction = action;
  const draft = roomInvitation("https://pod.example/room/");
  expect(await committedAction(recipient, draft)).toEqual({ delivered: true, inbox });

  options = { clock: () => 1 };
  suspended = true;
  await act(() => startTransition(update));
  expect(attemptedAction).toBeDefined();
  expect(attemptedAction).not.toBe(committedAction);
  expect(action).toBe(committedAction);
  expect(document.body.textContent).toBe("ready");
  expect(await committedAction(recipient, draft)).toEqual({ delivered: true, inbox });
  expect(await attemptedAction?.(recipient, draft)).toEqual({
    delivered: false,
    inbox: null,
    reason: "network",
  });
  expect(fetch).toHaveBeenCalledTimes(3);

  suspended = false;
  if (outcome === "discard") options = originalOptions;
  await act(async () => {
    if (outcome === "discard") update();
    blocker.resolve();
  });
  if (outcome === "commit") {
    expect(action).not.toBe(committedAction);
    expect(await committedAction(recipient, draft)).toEqual({
      delivered: false,
      inbox,
      reason: "network",
    });
    expect(await action(recipient, draft)).toEqual({ delivered: true, inbox });
    expect(fetch).toHaveBeenCalledTimes(5);
  } else {
    expect(action).toBe(committedAction);
    expect(await committedAction(recipient, draft)).toEqual({ delivered: true, inbox });
    expect(fetch).toHaveBeenCalledTimes(4);
  }
});
