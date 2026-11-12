// AUTHORED-BY Codex GPT-6.1-Sol
// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  renderHook,
  waitFor,
} from "../../../packages/suite-ui/node_modules/@testing-library/react";
import { resolveDisplayName, shortWebId } from "../src/lib/profile/display-name";
import { useDisplayNames } from "../src/lib/profile/use-display-names";
import { ABSENT } from "../src/lib/session/extension-session";
import { SessionContext } from "../src/lib/session/shell-pod-session";
import type { PodSession } from "../src/lib/session/types";

const webId = "https://people.example/profile#me";
const foaf = "http://xmlns.com/foaf/0.1/name";
const vcard = "http://www.w3.org/2006/vcard/ns#fn";
const schema = "http://schema.org/name";
function response(body: string) {
  return new Response(body, { headers: { "content-type": "text/turtle" } });
}
function session(body = "") {
  return {
    mode: "solid",
    webId: "https://pod.example/profile#me",
    displayName: "Me",
    storageUrl: "https://pod.example/",
    fetch: vi.fn(async () => response(body)),
    publicFetch: vi.fn(async () => response(body)),
    subscribe: () => () => {},
  } satisfies PodSession;
}
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([
  foaf,
  vcard,
  schema,
  "https://schema.org/name",
])("reads %s on the exact WebID subject", async (predicate) => {
  const account = session(
    `<${webId}> <${predicate}> "  Alice  " . <https://someone.example/#me> <${foaf}> "Wrong person" .`,
  );
  expect(await resolveDisplayName(account, webId)).toBe("Alice");
  expect(account.fetch).not.toHaveBeenCalled();
  expect(account.publicFetch.mock.calls[0]).toBeTruthy();
});
it("prefers foaf then vcard then schema, skipping blank and nonliteral terms", async () => {
  const account = session(
    `<${webId}> <${foaf}> <https://wrong.example/>, " "; <${vcard}> "Vcard"; <${schema}> "Schema" .`,
  );
  expect(await resolveDisplayName(account, webId)).toBe("Vcard");
  const preferred = session(`<${webId}> <${foaf}> "Foaf"; <${vcard}> "Vcard" .`);
  expect(await resolveDisplayName(preferred, webId)).toBe("Foaf");
});
it("uses You without fetching the current user, including in the hook", async () => {
  const account = session();
  expect(await resolveDisplayName(account, account.webId)).toBe("You");
  expect(account.publicFetch).not.toHaveBeenCalled();
  const hook = renderHook(() => useDisplayNames([account.webId], account));
  expect(hook.result.current(account.webId)).toBe("You");
});
it("deduplicates concurrent and cached reads, isolating account sessions", async () => {
  const account = session(`<${webId}> <${foaf}> "Alice" .`);
  const one = resolveDisplayName(account, webId);
  expect(resolveDisplayName(account, webId)).toBe(one);
  expect(await one).toBe("Alice");
  expect(await resolveDisplayName(account, webId)).toBe("Alice");
  expect(account.publicFetch).toHaveBeenCalledTimes(1);
  expect(await resolveDisplayName(session(`<${webId}> <${foaf}> "Bob" .`), webId)).toBe("Bob");
});
it.each([
  "",
  "malformed turtle",
])("briefly caches missing names or parsing failures: %j", async (body) => {
  let now = 1000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const account = session(body);
  expect(await resolveDisplayName(account, webId)).toBe("people.example");
  expect(await resolveDisplayName(account, webId)).toBe("people.example");
  expect(account.publicFetch).toHaveBeenCalledTimes(1);
  now += 30_001;
  expect(await resolveDisplayName(account, webId)).toBe("people.example");
  expect(account.publicFetch).toHaveBeenCalledTimes(2);
});
it("falls back on network failure and rejects URLs with unsafe schemes or credentials", async () => {
  const account = session();
  account.publicFetch.mockRejectedValue(new TypeError("offline"));
  expect(await resolveDisplayName(account, webId)).toBe("people.example");
  for (const id of [
    "broken",
    "file:///etc/passwd",
    "https://user:pass@people.example/",
    "https://user@people.example/",
  ])
    expect(await resolveDisplayName(account, id)).not.toBe(id);
  expect(account.publicFetch).toHaveBeenCalledTimes(1);
  expect(shortWebId(undefined)).toBe("Unknown author");
  expect(shortWebId("file:///profile")).toBe("Unknown author");
});
it("authenticates only inside pod scope and refuses redirects on foreign public reads", async () => {
  const own = "https://pod.example/friend#me";
  const account = session(`<${own}> <${foaf}> "Friend" .`);
  expect(await resolveDisplayName(account, own)).toBe("Friend");
  expect(account.fetch).toHaveBeenCalledOnce();
  expect(account.publicFetch).not.toHaveBeenCalled();
  const publicHttp = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => response(""));
  const foreign = { ...account, publicFetch: publicHttp };
  await resolveDisplayName(foreign, webId);
  expect(publicHttp.mock.calls[0]?.[0]).toBe("https://people.example/profile");
  expect(publicHttp.mock.calls[0]?.[1]).toMatchObject({ credentials: "omit", redirect: "error" });
});
it("uses page fetch for foreign profiles in demo sessions", async () => {
  const http = vi.fn(async () => response(`<${webId}> <${foaf}> "Alice" .`));
  vi.stubGlobal("fetch", http);
  const account = { ...session(), mode: "demo", reset: async () => {} } satisfies PodSession;
  expect(await resolveDisplayName(account, webId)).toBe("Alice");
  expect(http).toHaveBeenCalledOnce();
});
it("resolves hook names through the session context and handles unknown identities", async () => {
  const account = session(`<${webId}> <${foaf}> "Alice" .`);
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <SessionContext.Provider
      value={{
        status: "ready",
        session: account,
        extension: ABSENT,
        connectExtension: async () => {},
      }}
    >
      {children}
    </SessionContext.Provider>
  );
  const hook = renderHook(() => useDisplayNames([webId, undefined, webId]), { wrapper });
  expect(hook.result.current(webId)).toBe("people.example");
  await waitFor(() => expect(hook.result.current(webId)).toBe("Alice"));
  expect(hook.result.current("https://unknown.example/#me")).toBe("unknown.example");
  expect(hook.result.current(undefined)).toBe("Unknown author");
  expect(account.publicFetch).toHaveBeenCalledOnce();
});
it("fences late hook results on account switches, key changes and unmount", async () => {
  const alice = session();
  let reply!: (response: Response) => void;
  alice.publicFetch.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        reply = resolve;
      }),
  );
  const bob = session(`<${webId}> <${foaf}> "Bob" .`);
  const hook = renderHook(({ account, ids }) => useDisplayNames(ids, account), {
    initialProps: { account: alice, ids: [webId] },
  });
  hook.rerender({ account: bob, ids: [webId] });
  await waitFor(() => expect(hook.result.current(webId)).toBe("Bob"));
  await act(async () => reply(response(`<${webId}> <${foaf}> "Alice" .`)));
  expect(hook.result.current(webId)).toBe("Bob");
  hook.rerender({ account: bob, ids: ["https://other.example/#me"] });
  expect(hook.result.current(webId)).toBe("people.example");
  hook.unmount();
});
