// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createApprovalGate,
  createExecutor,
  InMemorySessions,
  responsePageError,
  type WriteResponsePolicy,
} from "@jeswr/site-executor";
import {
  type Operation,
  readSiteModel,
  SCHEMA,
  type SiteModel,
  writeSiteModel,
} from "@jeswr/site-model";
import { expect, it } from "vitest";
import { toParameter } from "../src/operations.js";
import { clusterRequests } from "../src/templates.js";
import type { RecordedRequest } from "../src/types.js";
import { learnWriteResponses } from "../src/write-responses.js";

const origin = "https://shop.test";
const provenance = {
  method: "demonstration" as const,
  learnedAt: "2026-11-13T00:00:00Z",
  derivedFrom: [],
  confidence: 1,
};
const create: Operation = {
  id: "urn:create-product",
  label: "Create product",
  actionType: `${SCHEMA}CreateAction`,
  effect: "irreversible-write",
  session: "none",
  provenance,
  inputs: [
    {
      name: "name",
      path: [`${SCHEMA}object`, `${SCHEMA}name`],
      location: "form",
      range: "http://www.w3.org/2001/XMLSchema#string",
      required: true,
      default: "Example widget",
    },
  ],
  request: {
    method: "POST",
    urlTemplate: `${origin}/products/save`,
    contentType: "application/x-www-form-urlencoded",
  },
};
const read: Operation = {
  ...create,
  id: "urn:read-product",
  actionType: `${SCHEMA}ViewAction`,
  effect: "read",
  inputs: [
    {
      name: "id",
      path: [],
      location: "query",
      range: "http://www.w3.org/2001/XMLSchema#string",
      required: true,
    },
  ],
  request: { method: "GET", urlTemplate: `${origin}/products/rows{?id}` },
  extraction: {
    format: "json",
    itemPath: "/items",
    totalPath: "/total",
    itemType: `${SCHEMA}Product`,
    fields: [
      { property: `${SCHEMA}identifier`, path: "/id" },
      { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
      { property: `${SCHEMA}name`, path: "/name", untrusted: true },
    ],
  },
};
const landing = `${origin}/products/edit/id/42`;
const scriptPage = '<main id="editor"></main><script src="/editor.js"></script>';
function trace(): RecordedRequest[] {
  const record = (changes: Partial<RecordedRequest>): RecordedRequest => ({
    seq: 0,
    phase: "demonstration",
    demonstration: "product",
    method: "GET",
    url: landing,
    resourceType: "document",
    requestHeaders: {},
    cookieNames: [],
    status: 200,
    contentType: "text/html",
    ...changes,
  });
  return [
    record({
      seq: 1,
      method: "POST",
      url: create.request.urlTemplate,
      postData: "name=Example+widget",
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
      status: 303,
      redirectedTo: landing,
    }),
    record({ seq: 2, redirectedFrom: 1, bodySample: scriptPage }),
    record({
      seq: 3,
      url: `${origin}/products/rows?id=42`,
      contentType: "application/json",
      bodySample: JSON.stringify({
        total: 1,
        items: [{ id: "42", url: `${origin}/products/42`, name: "Example widget" }],
      }),
    }),
  ];
}
async function execute(
  policy: WriteResponsePolicy | undefined,
  mode = "matching",
  operation = create,
  learnedReads = [read],
) {
  const model: SiteModel = {
    id: "urn:model",
    site: origin,
    generatedAt: provenance.learnedAt,
    version: "1",
    operations: [operation, ...learnedReads],
    flows: [],
  };
  const gate = createApprovalGate();
  const authorized: string[] = [];
  let posts = 0,
    reads = 0;
  const sessions = new InMemorySessions();
  sessions.set(origin, undefined, {
    cookies: [
      {
        name: "session",
        value: "fixture-session-secret",
        domain: "shop.test",
        path: "/",
        secure: true,
        httpOnly: true,
      },
    ],
  });
  const executor = createExecutor({
    model: readSiteModel(await writeSiteModel(model)),
    sessions,
    writeResponses: policy ? { [operation.id]: policy } : {},
    gate: {
      authorize: async (request) => {
        authorized.push(request.effect);
        if (mode === "read denied" && request.effect === "read")
          return { kind: "deny", reason: "Fixture denies verification" };
        return gate.authorize(request);
      },
    },
    fetch: async (input, init) => {
      const url = new URL(String(input));
      expect(url.origin).toBe(origin);
      expect(new Headers(init?.headers).get("cookie")).toContain("fixture-session-secret");
      if (init?.method === "POST") {
        posts++;
        return new Response(null, {
          status: 303,
          headers: { location: operation === create ? "/products/edit/id/73" : "/products" },
        });
      }
      if (url.pathname === "/products/rows") {
        reads++;
        expect(authorized.at(-1)).toBe("read");
        expect(url.searchParams.get("id")).toBe("73");
        const item = {
          id: mode === "wrong identity" ? "74" : "73",
          url:
            mode === "missing IRI"
              ? undefined
              : `${origin}${mode.startsWith("/") ? mode : "/products/73"}`,
          name: mode === "mismatched name" ? "Other widget" : "Example widget",
        };
        if (mode === "detail")
          return Response.json({ url: `${origin}/products/73`, name: "Example widget" });
        if (mode === "non-success") return new Response("Unavailable", { status: 503 });
        return Response.json({
          total: mode === "partial" || mode === "two items" ? 2 : mode === "zero items" ? 0 : 1,
          ...(mode === "error envelope" ? { ok: false } : {}),
          items: mode === "two items" ? [item, item] : mode === "zero items" ? [] : [item],
          echo: "fixture-session-secret",
        });
      }
      return new Response(
        operation === create
          ? scriptPage
          : mode === "failed delete"
            ? '<main>Products</main><div role="alert" class="alert-danger">Your product could not be deleted.</div>'
            : `<main>Products</main>${mode === "missing alert" ? "" : `<div role="alert">${mode === "different alert" ? "Could not delete" : "Deleted successfully"}</div>`}`,
      );
    },
  });
  const request = { node: "urn:request", types: [operation.actionType], values: () => [] };
  const pending = await executor.execute(request);
  expect(pending.status).toBe("needs-approval");
  expect(posts).toBe(0);
  expect(reads).toBe(0);
  if (!pending.approval) throw new Error("Missing approval");
  gate.approve(pending.approval.id);
  const result = await executor.execute(request, { approvalId: pending.approval.id });
  expect(posts).toBe(1);
  expect(result.committed).toHaveLength(1);
  expect(JSON.stringify(result)).not.toContain("fixture-session-secret");
  expect(
    (
      await executor.execute(request, {
        excludeFingerprints: result.committed.map((c) => c.fingerprint),
      })
    ).errorKind,
  ).toBe("repeat");
  expect(posts).toBe(1);
  return { result, reads };
}

it("learns a script-rendered create landing read-back and completes with exactly one matching item", async () => {
  const policy = learnWriteResponses([create, read], trace(), origin)[create.id];
  expect(policy?.readBack).toEqual({
    operation: read.id,
    bind: { id: { identity: true } },
    identityPattern: `${origin}/products/{id}`,
  });
  expect(policy?.inputEvidence).toEqual({ input: "name", property: `${SCHEMA}name` });
  const { result, reads } = await execute(policy);
  expect(result.outcome?.status).toBe("completed");
  expect(result.outcome?.result).toBe(`${origin}/products/edit/id/73`);
  expect(reads).toBe(1);
});
it.each([
  "two items",
  "mismatched name",
  "wrong identity",
  "read denied",
  "zero items",
  "partial",
  "error envelope",
  "non-success",
  "/categories/73",
  "/stores/other/products/73",
  "missing IRI",
])("keeps created identity Uncertain when read-back returns %s", async (mode) => {
  const policy = learnWriteResponses([create, read], trace(), origin)[create.id];
  const { result } = await execute(policy, mode);
  expect(result.outcome?.status).toBe("uncertain");
  expect(result.outcome?.result).toBeUndefined();
});
it("keeps a create Uncertain when its read-back is not learned", async () => {
  const policy = learnWriteResponses([create, read], trace(), origin)[create.id];
  expect(learnWriteResponses([create], trace(), origin)).toEqual({});
  const { result, reads } = await execute(policy, "matching", create, []);
  expect(result.outcome?.status).toBe("uncertain");
  expect(reads).toBe(0);
});
it.each([
  "two items",
  "mismatched name",
  "unfiltered",
  "not learned",
  "numeric identity only",
])("does not learn creation read-back from %s evidence", (mode) => {
  const records = trace();
  const follow = records[2];
  if (!follow) throw new Error("Missing follow-up");
  if (mode === "two items")
    follow.bodySample = JSON.stringify({
      total: 2,
      items: [
        { id: "42", name: "Example widget" },
        { id: "43", name: "Example widget" },
      ],
    });
  if (mode === "mismatched name")
    follow.bodySample = JSON.stringify({ total: 1, items: [{ id: "42", name: "Other widget" }] });
  if (mode === "unfiltered") follow.url = `${origin}/products/rows`;
  if (mode === "numeric identity only")
    follow.bodySample = JSON.stringify({ total: 1, items: [{ id: "42", name: "Example widget" }] });
  expect(
    learnWriteResponses(
      [create, read],
      records,
      origin,
      mode === "not learned" ? [create] : [create, read],
    ),
  ).toEqual({});
});
it.each(
  ["DeleteAction", "UpdateAction", "VoteAction"].flatMap((type) =>
    ["matching", "different alert", "missing alert"].map((mode) => [type, mode] as const),
  ),
)("never accepts a witnessed %s flash (%s) without a runtime verification read", async (type, mode) => {
  const remove = {
    ...create,
    actionType: `${SCHEMA}${type}`,
    inputs: [
      ...create.inputs,
      {
        range: "http://www.w3.org/2001/XMLSchema#string",
        required: true,
        name: "id",
        location: "form" as const,
        path: [`${SCHEMA}object`, `${SCHEMA}identifier`],
        default: "73",
      },
    ],
  };
  const records = trace().slice(0, 2);
  const write = records[0],
    response = records[1];
  if (!write || !response) throw new Error("Missing landing");
  write.redirectedTo = `${origin}/products`;
  write.postData += "&id=42";
  response.url = `${origin}/products`;
  response.bodySample = '<main>Products</main><div role="alert">Deleted successfully</div>';
  response.responsePageError = false;
  const follow = trace()[2];
  if (!follow) throw new Error("Missing follow-up");
  follow.bodySample = JSON.stringify({
    total: type === "DeleteAction" ? 0 : 1,
    items: type === "DeleteAction" ? [] : [{ id: "42", name: "Example widget" }],
  });
  records.push(follow);
  const policy = learnWriteResponses([remove, read], records, origin)[remove.id];
  expect(policy?.successFlash).toBeUndefined();
  expect(JSON.stringify(policy ?? {})).not.toContain("Deleted successfully");
  const { result } = await execute(policy, mode, remove, []);
  expect(result.outcome?.status).toBe("uncertain");
  expect(result.outcome?.result).toBeUndefined();
});

it("learns a detail read-back whose trusted permalink supplies the created identity", async () => {
  if (!read.extraction) throw new Error("Missing extraction");
  const detail: Operation = {
    ...read,
    extraction: {
      ...read.extraction,
      itemPath: undefined,
      totalPath: undefined,
      fields: [
        { property: `${SCHEMA}url`, path: "/url", datatype: "iri" },
        { property: `${SCHEMA}name`, path: "/name", untrusted: true },
      ],
    },
  };
  const records = trace();
  const follow = records[2];
  if (!follow) throw new Error("Missing detail");
  follow.bodySample = JSON.stringify({ url: `${origin}/products/42`, name: "Example widget" });
  const policy = learnWriteResponses([create, detail], records, origin)[create.id];
  expect(policy?.readBack?.operation).toBe(detail.id);
  expect((await execute(policy, "detail", create, [detail])).result.outcome?.status).toBe(
    "completed",
  );
});

it("learns read-back from a witnessed follow-up crawl", () => {
  const records = trace();
  const follow = records[2];
  if (!follow) throw new Error("Missing follow-up");
  follow.phase = "crawl";
  follow.demonstration = undefined;
  expect(learnWriteResponses([create, read], records, origin)[create.id]?.readBack?.operation).toBe(
    read.id,
  );
});

it.each([
  ["/stores/main/products/73", "completed"],
  ["/stores/other/products/73", "uncertain"],
  ["/products/73", "uncertain"],
])("r12 retains the read-back tenant prefix for %s", async (url, expected) => {
  const records = trace();
  const follow = records[2];
  if (!follow) throw new Error("Missing follow-up");
  follow.bodySample = JSON.stringify({
    total: 1,
    items: [{ id: "42", url: `${origin}/stores/main/products/42`, name: "Example widget" }],
  });
  const policy = learnWriteResponses([create, read], records, origin)[create.id];
  expect(policy?.readBack?.identityPattern).toBe(`${origin}/stores/main/products/{id}`);
  expect((await execute(policy, url)).result.outcome?.status).toBe(expected);
});

it("r12 admits witnessed read-item aliases and rejects an unwitnessed equal-ID crawl URL", async () => {
  const records = trace();
  const follow = records[2];
  if (!follow) throw new Error("Missing follow-up");
  follow.bodySample = JSON.stringify({
    total: 1,
    items: [
      {
        id: "42",
        url: [`${origin}/products/42`, `${origin}/catalogue/products/42`],
        name: "Example widget",
      },
    ],
  });
  records.push({ ...follow, seq: 4, phase: "crawl", url: `${origin}/categories/42` });
  const policy = learnWriteResponses([create, read], records, origin)[create.id];
  expect(policy?.readBack?.identityAliases).toEqual([`${origin}/catalogue/products/{id}`]);
  expect((await execute(policy, "/catalogue/products/73")).result.outcome?.status).toBe(
    "completed",
  );
  expect((await execute(policy, "/categories/73")).result.outcome?.status).toBe("uncertain");
});

it("r12 learns a read-back alias only from a recorder-linked GET redirect", async () => {
  const records = trace();
  const follow = records[2];
  if (!follow) throw new Error("Missing follow-up");
  records.push({
    ...follow,
    seq: 3,
    method: "GET",
    status: 302,
    url: `${origin}/catalogue/products/42`,
    redirectedTo: follow.url,
    bodySample: undefined,
  });
  follow.seq = 4;
  follow.redirectedFrom = 3;
  // The query read URL is not an identity alias, so only a detail read can witness it.
  follow.url = `${origin}/products/42`;
  const parent = records[3];
  if (!parent) throw new Error("Missing parent");
  parent.redirectedTo = follow.url;
  const detail = {
    ...read,
    request: { method: "GET" as const, urlTemplate: `${origin}/products/{id}` },
    inputs: read.inputs.map((p) => ({ ...p, location: "path" as const })),
  };
  const policy = learnWriteResponses([create, detail], records, origin)[create.id];
  expect(policy?.readBack?.identityAliases).toEqual([`${origin}/catalogue/products/{id}`]);
});

function deletionEvidence() {
  const remove: Operation = {
    ...create,
    actionType: `${SCHEMA}DeleteAction`,
    inputs: [
      {
        name: "id",
        path: [`${SCHEMA}object`, `${SCHEMA}identifier`],
        location: "form",
        range: "http://www.w3.org/2001/XMLSchema#string",
        required: true,
        default: "73",
      },
    ],
  };
  const records = trace();
  const [write, response, follow] = records;
  if (!write || !response || !follow) throw new Error("Missing deletion evidence");
  write.postData = "id=42";
  write.redirectedTo = `${origin}/products`;
  response.url = `${origin}/products`;
  response.bodySample = '<main>Products</main><div role="alert">Deleted successfully</div>';
  response.responsePageError = false;
  follow.bodySample = JSON.stringify({ total: 0, items: [] });
  return { remove, records, write, response, follow };
}

it("r12 never learns a failed-delete demonstration flash or completes the identical failure", async () => {
  const { remove, records, response } = deletionEvidence();
  response.bodySample =
    '<main>Products</main><div role="alert" class="alert-danger">Your product could not be deleted.</div>';
  response.responsePageError = true;
  const policies = learnWriteResponses([remove, read], records, origin);
  expect(policies[remove.id]?.successFlash).toBeUndefined();
  const { result } = await execute(policies[remove.id], "failed delete", remove, []);
  expect(result.outcome?.status).toBe("uncertain");
});

it.each([
  "no read",
  "item remains",
  "other identity",
  "non-success",
  "missing root",
  "error envelope",
  "recorder error",
  "unmarked landing",
  "after another write",
])("r12 learns no success flash without independent deletion evidence: %s", (mode) => {
  const { remove, records, follow, response } = deletionEvidence();
  if (mode === "no read") records.pop();
  if (mode === "item remains")
    follow.bodySample = JSON.stringify({ total: 1, items: [{ id: "42" }] });
  if (mode === "other identity") follow.url = `${origin}/products/rows?id=43`;
  if (mode === "non-success") follow.status = 503;
  if (mode === "missing root") follow.bodySample = JSON.stringify({ total: 0 });
  if (mode === "error envelope")
    follow.bodySample = JSON.stringify({ total: 0, items: [], ok: false });
  if (mode === "recorder error") response.responsePageError = true;
  if (mode === "unmarked landing") response.responsePageError = undefined;
  if (mode === "after another write") {
    follow.seq = 4;
    records.push({ ...records[0], ...follow, seq: 3, method: "POST", bodySample: undefined });
  }
  expect(
    learnWriteResponses([remove, read], records, origin)[remove.id]?.successFlash,
  ).toBeUndefined();
});

it("does not learn a success flash even from a successful deletion follow-up crawl", async () => {
  const { remove, records, follow } = deletionEvidence();
  follow.phase = "crawl";
  follow.demonstration = undefined;
  const policy = learnWriteResponses([remove, read], records, origin)[remove.id];
  expect(policy?.successFlash).toBeUndefined();
  expect((await execute(policy, "matching", remove, [])).result.outcome?.status).toBe("uncertain");
});

it.each([
  '<div role="alert" class="alert-danger">Failed</div>',
  '<div role="alert" class="warning">Try again</div>',
  '<div role="alert" class="error">Try again</div>',
  '<div role="alert" aria-invalid="true">Invalid</div>',
])("r12 rejects error-classed flash regions even if a supplied recorder flag says success (%s)", (body) => {
  const { remove, records, response } = deletionEvidence();
  response.bodySample = body;
  expect(responsePageError(body, "text/html", false)).toBe(true);
  expect(
    learnWriteResponses([remove, read], records, origin)[remove.id]?.successFlash,
  ).toBeUndefined();
});

it.each([
  false,
  true,
])("retains the initial list filter scope without defaulting a later read-back identity (initially filtered=%s)", (filtered) => {
  const follow = trace()[2];
  if (!follow || !read.extraction) throw new Error("Missing read");
  const filteredUrl = `${origin}/products/rows?filters[id]=42`;
  const candidates = clusterRequests(
    [
      {
        ...follow,
        seq: 0,
        phase: "crawl",
        url: filtered ? filteredUrl : `${origin}/products/rows`,
      },
      { ...follow, seq: 1, url: filteredUrl },
    ],
    origin,
  );
  const candidate = candidates[0];
  const parameter = candidate?.params.find((p) => p.name === "filters%5Bid%5D");
  if (!candidate || !parameter) throw new Error("Missing learned filter");
  const result = toParameter(
    candidate,
    parameter,
    { actionType: `${SCHEMA}ViewAction`, effect: "read", label: "Read products", confidence: 1 },
    read.extraction,
  );
  expect(result.default).toBe(filtered ? "42" : undefined);
  expect(result.example).toBe("42");
});
