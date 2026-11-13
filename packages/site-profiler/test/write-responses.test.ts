// AUTHORED-BY Codex GPT-6.1-Sol
import { createApprovalGate, createExecutor, InMemorySessions } from "@jeswr/site-executor";
import { type Operation, SCHEMA, type SiteModel } from "@jeswr/site-model";
import { expect, it } from "vitest";
import { responsePageError } from "../src/response-evidence.js";
import type { RecordedRequest } from "../src/types.js";
import { learnWriteResponses } from "../src/write-responses.js";

function need<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Missing fixture value");
  return value;
}

const origin = "https://forum.test";
const provenance = {
  method: "demonstration" as const,
  learnedAt: "2026-11-13T00:00:00Z",
  derivedFrom: [],
  confidence: 0.8,
};
const create: Operation = {
  id: "urn:fixture:create",
  actionType: `${SCHEMA}CreateAction`,
  label: "Create post",
  inputs: [],
  request: { method: "POST", urlTemplate: `${origin}/submit` },
  effect: "irreversible-write",
  session: "none",
  provenance,
};
const read: Operation = {
  ...create,
  id: "urn:fixture:read",
  effect: "read",
  actionType: `${SCHEMA}ViewAction`,
  request: { method: "GET", urlTemplate: `${origin}/f/{forum}/{postId}/{slug}` },
  inputs: ["forum", "postId", "slug"].map((name) => ({
    name,
    location: "path",
    path: [],
    required: true,
    range: "http://www.w3.org/2001/XMLSchema#string",
  })),
  extraction: {
    format: "json",
    itemType: `${SCHEMA}DiscussionForumPosting`,
    idField: `${SCHEMA}url`,
    fields: [
      { property: `${SCHEMA}identifier`, path: "/id" },
      { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
    ],
  },
};
const location = `${origin}/f/ExampleForum/42/example-post`;
const record = (changes: Partial<RecordedRequest>): RecordedRequest => ({
  seq: 0,
  phase: "demonstration",
  demonstration: "create-post",
  method: "GET",
  url: location,
  resourceType: "document",
  requestHeaders: {},
  cookieNames: [],
  status: 200,
  contentType: "application/json",
  ...changes,
});
function evidence(): RecordedRequest[] {
  return [
    record({
      seq: 0,
      method: "POST",
      url: `${origin}/submit`,
      status: 303,
      redirectedTo: location,
    }),
    record({ seq: 1, redirectedFrom: 0, bodySample: JSON.stringify({ id: "42", url: location }) }),
  ];
}

it("learns the witnessed route, hop count, status and item read using only identity/declared path slots", () => {
  expect(learnWriteResponses([create, read], evidence(), origin)).toEqual({
    [create.id]: {
      createdLocationPattern: "/f/{forum}/{id}/{slug}",
      redirectCount: 1,
      finalStatus: 200,
      extraction: read.extraction,
    },
  });
  expect(learnWriteResponses([create], evidence(), origin)[create.id]?.createdLocationPattern).toBe(
    "/f/ExampleForum/{id}/example-post",
  );
});

it("slots the labelled identity without widening equal routing configuration numbers", () => {
  const destination = `${origin}/products/id/4/set/4/type/simple`;
  const trace = evidence();
  need(trace[0]).redirectedTo = destination;
  need(trace[1]).url = destination;
  expect(learnWriteResponses([create], trace, origin)[create.id]?.createdLocationPattern).toBe(
    "/products/id/{id}/set/4/type/simple",
  );
});

it("retains the witnessed redirect count without admitting a different resource", () => {
  const trace = evidence();
  trace.splice(1, 0, record({ seq: 2, redirectedFrom: 0, status: 302, redirectedTo: location }));
  need(trace[2]).redirectedFrom = 2;
  expect(learnWriteResponses([create, read], trace, origin)[create.id]?.redirectCount).toBe(2);
});

it.each([
  ["unwitnessed redirect", (trace: RecordedRequest[]) => trace.slice(0, 1)],
  [
    "unrelated later GET",
    (trace: RecordedRequest[]) => trace.map((r) => ({ ...r, redirectedFrom: undefined })),
  ],
  [
    "off-origin hop",
    (trace: RecordedRequest[]) => {
      need(trace[0]).redirectedTo = "https://elsewhere.test/f/ExampleForum/42/example-post";
      return trace;
    },
  ],
  [
    "off-origin detour returning to the resource",
    (trace: RecordedRequest[]) => {
      trace.splice(
        1,
        0,
        record({
          seq: 2,
          redirectedFrom: 0,
          url: "https://elsewhere.test/",
          status: 302,
          redirectedTo: location,
        }),
      );
      need(trace[2]).redirectedFrom = 2;
      return trace;
    },
  ],
  [
    "error hop",
    (trace: RecordedRequest[]) => {
      trace.splice(
        1,
        0,
        record({
          seq: 2,
          redirectedFrom: 0,
          url: `${origin}/errors/validation`,
          status: 302,
          redirectedTo: location,
        }),
      );
      need(trace[0]).redirectedTo = `${origin}/errors/validation`;
      need(trace[2]).redirectedFrom = 2;
      return trace;
    },
  ],
  [
    "HTTP error",
    (trace: RecordedRequest[]) => {
      need(trace[1]).status = 422;
      return trace;
    },
  ],
  [
    "JSON validation page",
    (trace: RecordedRequest[]) => {
      need(trace[1]).bodySample = JSON.stringify({
        id: "42",
        url: location,
        errors: ["Invalid title"],
      });
      return trace;
    },
  ],
  [
    "HTML validation page",
    (trace: RecordedRequest[]) => {
      need(trace[1]).contentType = "text/html";
      need(trace[1]).bodySample =
        '<h1>Validation error</h1><form><p class="form-error-message">Invalid title</p></form>';
      return trace;
    },
  ],
  [
    "truncated evidence",
    (trace: RecordedRequest[]) => {
      need(trace[1]).bodyTruncated = true;
      return trace;
    },
  ],
  [
    "wrong extracted identity",
    (trace: RecordedRequest[]) => {
      need(trace[1]).bodySample = JSON.stringify({
        id: "99",
        url: `${origin}/f/ExampleForum/99/another-post`,
      });
      return trace;
    },
  ],
  [
    "crawl instead of demonstration",
    (trace: RecordedRequest[]) => trace.map((r) => ({ ...r, phase: "crawl" as const })),
  ],
])("does not learn from %s", (_name, change) => {
  expect(learnWriteResponses([create, read], change(evidence()), origin)).toEqual({});
});

it.each([
  true,
  false,
])("executor completes only with the learned policy (policy=%s), sending one approved POST", async (learned) => {
  const policies = learnWriteResponses([create, read], evidence(), origin);
  const model: SiteModel = {
    id: "urn:fixture:model",
    site: origin,
    version: "1",
    generatedAt: provenance.learnedAt,
    operations: [create],
    flows: [],
  };
  const gate = createApprovalGate();
  let posts = 0;
  const executor = createExecutor({
    model,
    gate,
    sessions: new InMemorySessions(),
    writeResponses: learned ? policies : undefined,
    fetch: async (_url, init) => {
      if (init?.method === "POST") {
        posts++;
        return new Response(null, { status: 303, headers: { Location: location } });
      }
      return Response.json({ id: "42", url: location });
    },
  });
  const request = { node: "urn:fixture:request", types: [create.actionType], values: () => [] };
  const pending = await executor.execute(request);
  expect(pending.status).toBe("needs-approval");
  expect(posts).toBe(0);
  gate.approve(need(pending.approval).id);
  const result = await executor.execute(request, { approvalId: need(pending.approval).id });
  expect(posts).toBe(1);
  expect(result.outcome?.status).toBe(learned ? "completed" : "uncertain");
  expect(result.outcome?.result).toBe(learned ? location : undefined);
  expect(result.observations[0]?.turtle).toContain(learned ? "Completed" : "Uncertain");
  expect(result.committed).toHaveLength(1);
  const repeated = await executor.execute(request, {
    excludeFingerprints: result.committed.map((c) => c.fingerprint),
  });
  expect(repeated.errorKind).toBe("repeat");
  expect(posts).toBe(1);
});

it.each([
  "final status",
  "hop count",
  "missing item",
  "conflicting identity",
  "different resource",
  "off-origin item",
])("executor refuses changed learned %s evidence", async (changed) => {
  const policy = learnWriteResponses([create, read], evidence(), origin);
  const model: SiteModel = {
    id: "urn:fixture:model",
    site: origin,
    version: "1",
    generatedAt: provenance.learnedAt,
    operations: [create],
    flows: [],
  };
  const gate = createApprovalGate();
  if (changed === "hop count") need(policy[create.id]).redirectCount = 2;
  const executor = createExecutor({
    model,
    gate,
    sessions: new InMemorySessions(),
    writeResponses: policy,
    fetch: async (_url, init) =>
      init?.method === "POST"
        ? new Response(null, { status: 303, headers: { Location: location } })
        : Response.json(
            changed === "missing item"
              ? {}
              : {
                  id: "42",
                  url:
                    changed === "conflicting identity"
                      ? `${origin}/f/ExampleForum/99/other-post`
                      : changed === "different resource"
                        ? `${origin}/products/42`
                        : changed === "off-origin item"
                          ? "https://elsewhere.test/products/42"
                          : location,
                },
            {
              status: changed === "final status" ? 201 : 200,
            },
          ),
  });
  const request = { node: "urn:fixture:request", types: [create.actionType], values: () => [] };
  const pending = await executor.execute(request);
  gate.approve(need(pending.approval).id);
  expect(
    (await executor.execute(request, { approvalId: need(pending.approval).id })).outcome?.status,
  ).toBe("uncertain");
});

it("learns and verifies an on-origin item permalink alias with the same identity", async () => {
  const alias = `${origin}/f/ExampleForum/42`;
  const itemRead = {
    ...read,
    extraction: {
      ...need(read.extraction),
      fields: need(read.extraction).fields.filter((f) => f.property === `${SCHEMA}url`),
    },
  };
  const trace = evidence();
  need(trace[1]).bodySample = JSON.stringify({ url: alias });
  const policies = learnWriteResponses([create, itemRead], trace, origin);
  expect(policies[create.id]?.extraction).toEqual(itemRead.extraction);
  const gate = createApprovalGate();
  const executor = createExecutor({
    model: {
      id: "urn:fixture:model",
      site: origin,
      version: "1",
      generatedAt: provenance.learnedAt,
      operations: [create],
      flows: [],
    },
    sessions: new InMemorySessions(),
    gate,
    writeResponses: policies,
    fetch: async (_url, init) =>
      init?.method === "POST"
        ? new Response(null, { status: 303, headers: { Location: location } })
        : Response.json({ url: alias }),
  });
  const request = { node: "urn:fixture:request", types: [create.actionType], values: () => [] };
  const pending = await executor.execute(request);
  gate.approve(need(pending.approval).id);
  const completed = await executor.execute(request, { approvalId: need(pending.approval).id });
  expect(completed.outcome?.status).toBe("completed");
  expect(completed.outcome?.result).toBe(location);
  need(trace[1]).bodySample = JSON.stringify({ url: "https://elsewhere.test/f/ExampleForum/42" });
  expect(learnWriteResponses([create, itemRead], trace, origin)).toEqual({});
});

it("learns a collection landing with a success notice without inventing a created identity", () => {
  const destination = `${origin}/forums/ExampleForum`;
  const itemRead: Operation = {
    ...read,
    request: { method: "GET", urlTemplate: `${origin}/forums/{forum}` },
    extraction: {
      format: "html",
      itemPath: "article",
      itemType: `${SCHEMA}CreativeWork`,
      fields: [{ property: `${SCHEMA}url`, path: "a", attribute: "href", datatype: "iri" }],
    },
  };
  const trace = evidence();
  need(trace[0]).redirectedTo = destination;
  Object.assign(need(trace[1]), {
    url: destination,
    contentType: "text/html",
    bodySample:
      '<div role="alert" class="alert-success">Deleted successfully</div><article><a href="/forums/Other">Other forum</a></article>',
  });
  expect(learnWriteResponses([create, itemRead], trace, origin)[create.id]).toMatchObject({
    createdLocationPattern: "/forums/{forum}",
    extraction: itemRead.extraction,
  });
  need(trace[1]).bodySample =
    '<div role="alert" class="alert-danger">Invalid request</div><article><a href="/forums/Other">Other forum</a></article>';
  expect(learnWriteResponses([create, itemRead], trace, origin)).toEqual({});
});

it("uses the actual guarded CSRF form page as Referer so native redirects retain their witnessed resource", async () => {
  const form = `${origin}/forms/new-canonical`;
  const operation: Operation = {
    ...create,
    csrf: [
      {
        source: {
          kind: "html",
          urlTemplate: `${origin}/forms/new`,
          selector: 'input[name="csrf"]',
          attribute: "value",
        },
        target: { kind: "form", name: "csrf" },
      },
    ],
  };
  const gate = createApprovalGate();
  let posts = 0;
  const executor = createExecutor({
    model: {
      id: "urn:fixture:model",
      site: origin,
      version: "1",
      generatedAt: provenance.learnedAt,
      operations: [operation],
      flows: [],
    },
    sessions: new InMemorySessions(),
    gate,
    writeResponses: learnWriteResponses([operation, read], evidence(), origin),
    fetch: async (input, init) => {
      const url = String(input);
      if (init?.method === "POST") {
        posts++;
        expect(new Headers(init.headers).get("referer")).toBe(form);
        return new Response(null, { status: 303, headers: { Location: location } });
      }
      if (url.endsWith("/forms/new"))
        return new Response(null, { status: 302, headers: { Location: form } });
      if (url === form) return new Response('<input name="csrf" value="fixture-csrf-secret">');
      return Response.json({ id: "42", url: location });
    },
  });
  const request = { node: "urn:fixture:request", types: [operation.actionType], values: () => [] };
  const pending = await executor.execute(request);
  expect(posts).toBe(0);
  gate.approve(need(pending.approval).id);
  expect(
    (await executor.execute(request, { approvalId: need(pending.approval).id })).outcome?.status,
  ).toBe("completed");
  expect(posts).toBe(1);
});

it("requires a full-response error check before learning from a bounded landing sample", () => {
  const trace = evidence();
  need(trace[1]).bodyTruncated = true;
  expect(learnWriteResponses([create], trace, origin)).toEqual({});
  const full = `<h1>Saved</h1>${" ".repeat(256 * 1024)}`;
  need(trace[1]).responsePageError = responsePageError(full, "text/html");
  expect(learnWriteResponses([create], trace, origin)[create.id]).toBeDefined();
  need(trace[1]).responsePageError = responsePageError(
    `${full}<p class="validation-error">Invalid title</p>`,
    "text/html",
  );
  expect(learnWriteResponses([create], trace, origin)).toEqual({});
});

it.each([
  "matching",
  "fragment",
  "other origin",
  "other route",
  "ambiguous",
])("resolves guarded form aliases to only one learned canonical Referer (%s)", async (kind) => {
  const form = `${origin}/f/ExampleForum/42`;
  const urls =
    kind === "matching"
      ? [location]
      : kind === "fragment"
        ? [`${location}#private-fragment`]
        : kind === "other origin"
          ? ["https://elsewhere.test/f/ExampleForum/42/example-post"]
          : kind === "other route"
            ? [`${origin}/products/42`]
            : [location, `${origin}/f/ExampleForum/42/another-slug`];
  const body = `<input name="csrf" value="fixture-csrf-secret">${urls.map((url) => `<article><a href="${url}">Example</a></article>`).join("")}`;
  const itemRead: Operation = {
    ...read,
    extraction: {
      format: "html",
      itemPath: "article",
      itemType: `${SCHEMA}DiscussionForumPosting`,
      idField: `${SCHEMA}url`,
      fields: [{ property: `${SCHEMA}url`, path: "a", attribute: "href", datatype: "iri" }],
    },
  };
  const operation: Operation = {
    ...create,
    csrf: [
      {
        source: {
          kind: "html",
          urlTemplate: form,
          selector: 'input[name="csrf"]',
          attribute: "value",
        },
        target: { kind: "form", name: "csrf" },
      },
    ],
  };
  const witness = evidence();
  Object.assign(need(witness[1]), {
    contentType: "text/html",
    bodySample: `<article><a href="${location}">Example</a></article>`,
  });
  const gate = createApprovalGate();
  let posts = 0;
  const executor = createExecutor({
    model: {
      id: "urn:fixture:model",
      site: origin,
      version: "1",
      generatedAt: provenance.learnedAt,
      operations: [operation],
      flows: [],
    },
    sessions: new InMemorySessions(),
    gate,
    writeResponses: learnWriteResponses([operation, itemRead], witness, origin),
    fetch: async (input, init) => {
      expect(new URL(String(input)).origin).toBe(origin);
      if (init?.method === "POST") {
        posts++;
        expect(new Headers(init.headers).get("referer")).toBe(
          kind === "matching" || kind === "fragment" ? location : form,
        );
        return new Response(null, { status: 303, headers: { Location: location } });
      }
      return new Response(body);
    },
  });
  const request = { node: "urn:fixture:request", types: [operation.actionType], values: () => [] };
  const pending = await executor.execute(request);
  expect(posts).toBe(0);
  gate.approve(need(pending.approval).id);
  const result = await executor.execute(request, { approvalId: need(pending.approval).id });
  if (kind === "matching") expect(result.outcome?.status).toBe("completed");
  expect(posts).toBe(1);
  expect(result.committed).toHaveLength(1);
});

it.each([
  "null",
  "0",
  "false",
  '"text"',
  "[]",
  "{}",
])("records boolean error evidence for a JSON primitive or empty document (%s)", (body) => {
  expect(responsePageError(body, "application/json")).toBe(false);
});
