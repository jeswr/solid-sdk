// AUTHORED-BY Claude Sonnet 5.5
import { shareNotification } from "@jeswr/pod-access/notify";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { PodSession } from "../src/lib/session/pod-session";
import { useSharedItems } from "../src/lib/shared/use-shared-items";
import { act, h, mount } from "./drive-ui-dom";

// The real inbox reader runs here: these tests assert which URLs the hook requests and with
// which transport, so credentials, confinement and the bound are exercised end to end.
const AS = "https://www.w3.org/ns/activitystreams#";
const LDP = "http://www.w3.org/ns/ldp#";
const ROOT = "https://8.8.8.8/";
const turtle = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/turtle" } });

function notification(object: string, day: number) {
  const draft = shareNotification(object, "Editor");
  return (
    `<#it> a <${AS}Announce>; <${AS}object> <${object}>; <${AS}summary> "${draft.summary}"; ` +
    `<${AS}published> "2026-01-${String(day).padStart(2, "0")}T00:00:00Z"^^<http://www.w3.org/2001/XMLSchema#dateTime>.`
  );
}

interface Pod {
  profile?: Response | undefined;
  inbox: string;
  members: Record<string, string>;
}
function makeSession(
  pod: Pod,
  extra: { webId?: string; publicFetch?: typeof fetch } = {},
): { session: PodSession; seen: string[] } {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    const url = input instanceof Request ? input.url : String(input);
    seen.push(url);
    if (url === `${ROOT}profile/card`)
      return pod.profile ?? turtle(`<#me> <${LDP}inbox> <${pod.inbox}>.`);
    if (url === pod.inbox)
      return turtle(
        `<> <${LDP}contains> ${Object.keys(pod.members)
          .map((name) => `<${name}>`)
          .join(", ")}.`,
      );
    const name = url.slice(pod.inbox.length);
    return name in pod.members
      ? turtle(pod.members[name] as string)
      : new Response(null, { status: 404 });
  };
  const base = {
    webId: extra.webId ?? `${ROOT}profile/card#me`,
    storageUrl: ROOT,
    displayName: "Alice",
    fetch: fetchImpl,
    subscribe: () => () => {},
  };
  const session: PodSession = extra.publicFetch
    ? { ...base, mode: "solid", publicFetch: extra.publicFetch }
    : { ...base, mode: "demo", reset: async () => {} };
  return { session, seen };
}

let current!: ReturnType<typeof useSharedItems>;
let session: PodSession;
function Probe() {
  current = useSharedItems(session);
  return h("p", {}, current.items.map((item) => item.name).join(","));
}
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

it("lists announced resources and requests only the profile, the inbox and its members", async () => {
  const pod: Pod = {
    inbox: `${ROOT}inbox/`,
    members: { "a.ttl": notification("https://bob.example/docs/plan.ttl", 2) },
  };
  const made = makeSession(pod);
  session = made.session;
  const view = await mount(h(Probe));
  expect(current.items.map((item) => item.url)).toEqual(["https://bob.example/docs/plan.ttl"]);
  expect(current.items[0]?.announced).toBe(true);
  expect(current.failure).toBeUndefined();
  expect(made.seen.sort()).toEqual([`${ROOT}profile/card`, pod.inbox, `${pod.inbox}a.ttl`].sort());
  await view.unmount();
});

it("never sends the session to an inbox outside the storage", async () => {
  const pod: Pod = { inbox: "https://203.0.113.9/inbox/", members: {} };
  const made = makeSession(pod);
  session = made.session;
  const view = await mount(h(Probe));
  expect(made.seen).toEqual([`${ROOT}profile/card`]);
  expect(current.failure).toBe("outside-storage");
  expect(current.items).toEqual([]);
  await view.unmount();
});

it("reads a profile outside the storage through the public fetch, not the session", async () => {
  const pod: Pod = { inbox: `${ROOT}inbox/`, members: {} };
  const publicSeen: string[] = [];
  const publicFetch: typeof fetch = async (input) => {
    publicSeen.push(input instanceof Request ? input.url : String(input));
    return turtle(`<#me> <${LDP}inbox> <${pod.inbox}>.`);
  };
  const made = makeSession(pod, { webId: "https://1.1.1.1/profile/card#me", publicFetch });
  session = made.session;
  const view = await mount(h(Probe));
  expect(publicSeen).toEqual(["https://1.1.1.1/profile/card"]);
  expect(made.seen).toEqual([pod.inbox]);
  expect(current.failure).toBeUndefined();
  await view.unmount();
});

it("drops http:, private-network and credentialed objects and keeps public HTTPS ones", async () => {
  const pod: Pod = {
    inbox: `${ROOT}inbox/`,
    members: {
      "a.ttl": notification("http://bob.example/plain.ttl", 1),
      "b.ttl": notification("https://192.168.0.1/router", 2),
      "c.ttl": notification("https://bob.example/ok.ttl", 3),
    },
  };
  session = makeSession(pod).session;
  const view = await mount(h(Probe));
  expect(current.items.map((item) => item.url)).toEqual(["https://bob.example/ok.ttl"]);
  await view.unmount();
});

it("shows a failed read as a failure, not as an empty inbox, and Retry reads again", async () => {
  const pod: Pod = {
    inbox: `${ROOT}inbox/`,
    members: { "a.ttl": notification("https://bob.example/docs/plan.ttl", 2) },
    profile: new Response(null, { status: 503 }),
  };
  const made = makeSession(pod);
  session = made.session;
  const view = await mount(h(Probe));
  expect(current.error).toBe(true);
  expect(current.failure).toBe("network");
  pod.profile = undefined;
  await act(async () => current.refresh());
  expect(current.error).toBe(false);
  expect(current.items).toHaveLength(1);
  await view.unmount();
});

it("reads past the old 50-member bound and flags an inbox over 100", async () => {
  const members: Record<string, string> = {};
  for (let i = 0; i < 120; i++)
    members[`n${String(i).padStart(3, "0")}.ttl`] = notification(
      `https://bob.example/docs/${i}.ttl`,
      (i % 28) + 1,
    );
  const pod: Pod = { inbox: `${ROOT}inbox/`, members };
  session = makeSession(pod).session;
  const view = await mount(h(Probe));
  expect(current.truncated).toEqual({ limit: 100 });
  expect(current.items.length).toBe(100);
  await view.unmount();
  const small: Pod = {
    inbox: `${ROOT}inbox/`,
    members: Object.fromEntries(Object.entries(members).slice(0, 60)),
  };
  session = makeSession(small).session;
  const second = await mount(h(Probe));
  expect(current.truncated).toBeUndefined();
  expect(current.items.length).toBe(60);
  await second.unmount();
});
