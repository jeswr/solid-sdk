// AUTHORED-BY Claude Opus 5.5
// Round-22 low finding 3: agent-browser widens the credential union with every CSRF rule's
// cookie source for redaction, but the credentials-only liveness control drops only declared
// credential and login cookies. A CSRF cookie (`XSRF-TOKEN`) stays in the control, as it does
// in the profiler's control. Every site, account and item here is fictional.
import {
  InMemorySessions,
  isLoginCredentialCookie,
  isSessionCredentialCookie,
  livenessSignature,
  notFoundSignature,
  type WriteResponsePolicy,
} from "@jeswr/site-executor";
import { type Extraction, type Operation, SCHEMA, type SiteModel } from "@jeswr/site-model";
import { expect, it } from "vitest";
import { createTaskExecutor, taskCredentialContext } from "../src/session.js";

const origin = "https://shop.test";
const provenance = {
  method: "demonstration" as const,
  learnedAt: "2026-11-14T00:00:00Z",
  confidence: 1,
  derivedFrom: [],
};
function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}
const listing: Extraction = {
  format: "json",
  itemType: `${SCHEMA}Product`,
  itemPath: "/items",
  fields: [{ property: `${SCHEMA}identifier`, path: "/id" }],
};
const liveRows = { items: [{ id: "80" }, { id: "81" }] };
const write: Operation = {
  id: "urn:write",
  label: "Delete example product",
  actionType: `${SCHEMA}DeleteAction`,
  effect: "irreversible-write",
  session: "signed-in",
  provenance,
  inputs: [
    {
      name: "id",
      path: [`${SCHEMA}object`, `${SCHEMA}identifier`],
      location: "path",
      range: "http://www.w3.org/2001/XMLSchema#string",
      required: true,
      default: "73",
    },
  ],
  request: {
    method: "POST",
    urlTemplate: `${origin}/products/delete/{id}`,
    contentType: "application/x-www-form-urlencoded",
  },
  // The write's CSRF token comes from a cookie: agent-browser adds it to the redaction union.
  csrf: [
    { source: { kind: "cookie", name: "XSRF-TOKEN" }, target: { kind: "header", name: "x-xsrf" } },
  ],
};
const item: Operation = {
  ...write,
  id: "urn:read",
  label: "Read example product",
  actionType: `${SCHEMA}ViewAction`,
  effect: "read",
  csrf: undefined,
  inputs: [{ ...required(write.inputs[0]), path: [], default: undefined }],
  request: { method: "GET", urlTemplate: `${origin}/products/{id}` },
  extraction: {
    format: "json",
    itemType: `${SCHEMA}Product`,
    fields: [
      { property: `${SCHEMA}identifier`, path: "/id" },
      { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
    ],
  },
};
const live: Operation = {
  ...item,
  id: "urn:live",
  label: "List example products",
  inputs: [],
  request: { method: "GET", urlTemplate: `${origin}/stores/main/listing` },
  extraction: listing,
};
const model = (): SiteModel => ({
  id: "urn:model",
  site: origin,
  generatedAt: provenance.learnedAt,
  version: "1",
  operations: [write, item, live],
  flows: [],
  login: [{ method: "password", sessionCookies: ["session"] }],
});
const policy = {
  createdLocationPattern: "/",
  completionOnly: true,
  verification: {
    operation: item.id,
    bind: { id: { input: "id" } },
    identityInput: "id",
    identityPattern: `${origin}/products/{id}`,
    changes: [],
    notFound: required(notFoundSignature(404, "text/plain", "Not Found")),
    liveness: {
      operation: live.id,
      bind: {},
      signature: required(
        livenessSignature(200, "application/json", JSON.stringify(liveRows), listing),
      ),
      anonymous: {
        refusal: "login-redirect",
        loginRoutes: [`${origin}/login`],
        route: `${origin}/login`,
      },
    },
  },
} as unknown as WriteResponsePolicy;

it("r22 the agent-browser credential union keeps XSRF-TOKEN for redaction only", () => {
  const sessions = new InMemorySessions();
  const context = taskCredentialContext({ sessions, site: origin, model: model() });
  expect(context.declaredNames).toEqual(["session", "XSRF-TOKEN"]);
  expect(context.credentialCookieNames).toEqual(["session"]);
  expect(isSessionCredentialCookie({ name: "XSRF-TOKEN", value: "x" }, context)).toBe(true);
  // Kept by the runtime control and by the profiler's (its context: login cookies and model).
  expect(isLoginCredentialCookie({ name: "XSRF-TOKEN" }, context)).toBe(false);
  expect(
    isLoginCredentialCookie(
      { name: "XSRF-TOKEN" },
      { loginCookieNames: ["session"], model: model() },
    ),
  ).toBe(false);
  expect(isLoginCredentialCookie({ name: "session" }, context)).toBe(true);
});

it("r22 an agent-browser deletion's control carries XSRF-TOKEN but not the session", async () => {
  const sessions = new InMemorySessions();
  sessions.set(origin, undefined, {
    cookies: [
      { name: "session", value: "fixture-secret-session", httpOnly: true },
      { name: "XSRF-TOKEN", value: "fixture-csrf-value", httpOnly: false },
    ].map((c) => ({ ...c, domain: "shop.test", path: "/", secure: true })),
  });
  const listed: string[] = [];
  let reads = 0;
  const executor = createTaskExecutor({
    model: model(),
    sessions,
    writeResponses: { [write.id]: policy },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const cookie = new Headers(init?.headers).get("cookie") ?? "";
      if ((init?.method ?? "GET") === "POST") {
        expect(new Headers(init?.headers).get("x-xsrf")).toBe("fixture-csrf-value");
        return new Response(null, { status: 204 });
      }
      if (url.pathname === "/stores/main/listing") {
        listed.push(cookie);
        return /(?:^|; )session=fixture-secret-session(?:;|$)/.test(cookie)
          ? Response.json(liveRows)
          : new Response(null, { status: 302, headers: { location: "/login" } });
      }
      reads++;
      return reads === 1
        ? Response.json({ id: "73", url: `${origin}/products/73` })
        : new Response("Not Found", { status: 404, headers: { "content-type": "text/plain" } });
    },
  });
  const request = { node: "urn:request", types: [write.actionType], values: () => [] };
  const pause = await executor.execute(request);
  expect(listed).toEqual([]);
  executor.approve?.(required(pause.approval).id);
  const result = await executor.execute(request, { approvalId: required(pause.approval).id });
  expect(result.outcome?.status).toBe("completed");
  expect(listed).toEqual([
    "session=fixture-secret-session; XSRF-TOKEN=fixture-csrf-value",
    "XSRF-TOKEN=fixture-csrf-value",
  ]);
});
