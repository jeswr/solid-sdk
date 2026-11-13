// AUTHORED-BY Codex GPT-6
import type { Operation } from "@jeswr/site-model";
import { describe, expect, it } from "vitest";
import type { RecordedRequest } from "../src/types.js";
import { s, sab, xsd } from "../src/util.js";
import { type Replayer, verifyOperations } from "../src/verify.js";

const origin = "https://shop.test";
const now = () => new Date("2026-11-13T10:00:00Z");
const checkout: Operation = {
  id: "urn:model#total",
  label: "View checkout (JSON)",
  actionType: s("ViewAction"),
  effect: "read",
  session: "signed-in",
  inputs: [
    {
      name: "delivery",
      path: [sab("delivery")],
      location: "query",
      range: xsd("string"),
      required: false,
      example: "canvas",
    },
  ],
  request: { method: "GET", urlTemplate: `${origin}/api/checkout{?delivery}` },
  extraction: {
    format: "json",
    itemType: s("Order"),
    fields: [{ property: s("totalPaymentDue"), path: "/totalPaymentDue" }],
  },
  provenance: {
    method: "demonstration",
    derivedFrom: [],
    learnedAt: now().toISOString(),
    confidence: 0.8,
  },
};

function recorded(path: string, extra: Partial<RecordedRequest> = {}): RecordedRequest {
  return {
    seq: 0,
    phase: "demonstration",
    method: "GET",
    url: `${origin}${path}`,
    resourceType: "xhr",
    requestHeaders: {},
    cookieNames: ["sid"],
    status: 200,
    ...extra,
  };
}

function replay(signedInStatus: (url: string, attempt: number) => number) {
  const calls: Array<{ url: string; signedIn: boolean }> = [];
  let attempt = 0;
  const replayer: Replayer = {
    async get(url, { signedIn }) {
      calls.push({ url, signedIn });
      return {
        status: signedIn ? signedInStatus(url, ++attempt) : 401,
        body: '{"totalPaymentDue":"20.00"}',
      };
    },
  };
  return { replayer, calls };
}

describe("verification with recorded successful requests", () => {
  it("prefers a demonstrated request over a crawl request and can verify without examples", async () => {
    const { replayer, calls } = replay(() => 200);
    const op: Operation = {
      ...checkout,
      inputs: [
        { name: "id", location: "path", path: [s("object")], range: s("Order"), required: true },
      ],
      request: { method: "GET", urlTemplate: `${origin}/orders/{id}` },
    };
    const { operations } = await verifyOperations([op], {
      replayer,
      now,
      haveSession: true,
      recordedRequests: [
        recorded("/products/1"),
        recorded("/orders/2", { phase: "crawl" }),
        recorded("/orders/3"),
      ],
    });
    expect(operations).toHaveLength(1);
    expect(calls.map((c) => c.url)).toEqual([`${origin}/orders/3`, `${origin}/orders/3`]);
  });

  it.each([
    "crawl",
    "demonstration",
  ] as const)("prefers a matching 2xx %s request over examples and failed probes", async (phase) => {
    const { replayer, calls } = replay((url) => (url.endsWith("delivery=standard") ? 200 : 400));
    const { operations, warnings } = await verifyOperations([checkout], {
      replayer,
      now,
      haveSession: true,
      recordedRequests: [
        recorded("/api/search?delivery=canvas"),
        recorded("/api/checkout?delivery=canvas", { status: 400, phase: "probe" }),
        recorded("/api/checkout?delivery=standard", { phase }),
      ],
    });
    expect(operations).toHaveLength(1);
    expect(operations[0]?.session).toBe("signed-in");
    expect(operations[0]?.provenance).toMatchObject({
      attempts: 1,
      successes: 1,
      lastVerified: now().toISOString(),
    });
    expect(warnings).toEqual([]);
    expect(calls).toEqual([
      { url: `${origin}/api/checkout?delivery=standard`, signedIn: false },
      { url: `${origin}/api/checkout?delivery=standard`, signedIn: true },
    ]);
  });

  it("retries once with another complete recorded tuple, without mixing optional defaults", async () => {
    const op: Operation = {
      ...checkout,
      inputs: [
        ...checkout.inputs,
        {
          name: "slot",
          path: [sab("slot")],
          range: xsd("string"),
          location: "query",
          required: false,
          default: "morning",
          example: "morning",
        },
      ],
      request: { method: "GET", urlTemplate: `${origin}/api/checkout{?delivery,slot}` },
    };
    const { replayer, calls } = replay((url) =>
      url.endsWith("delivery=express&slot=evening") ? 200 : 400,
    );
    const { operations } = await verifyOperations([op], {
      replayer,
      now,
      haveSession: true,
      recordedRequests: [
        recorded("/api/checkout?delivery=standard"),
        recorded("/api/checkout?delivery=express&slot=evening", { phase: "crawl" }),
      ],
    });
    expect(operations[0]?.provenance).toMatchObject({ attempts: 2, successes: 1 });
    expect(calls.map((c) => c.url)).toEqual([
      `${origin}/api/checkout?delivery=standard`,
      `${origin}/api/checkout?delivery=standard`,
      `${origin}/api/checkout?delivery=express&slot=evening`,
      `${origin}/api/checkout?delivery=express&slot=evening`,
    ]);
  });

  it("retries a recorded tuple once after a transient failure, even when it is the only one", async () => {
    const { replayer, calls } = replay((_url, attempt) => (attempt === 1 ? 503 : 200));
    const { operations } = await verifyOperations([checkout], {
      replayer,
      now,
      haveSession: true,
      recordedRequests: [recorded("/api/checkout?delivery=standard")],
    });
    expect(operations[0]?.provenance.attempts).toBe(2);
    expect(calls).toHaveLength(4);
  });

  it("drops after two failures and never retries a write", async () => {
    const { replayer, calls } = replay(() => 400);
    const write: Operation = {
      ...checkout,
      id: "urn:model#pay",
      effect: "payment",
      request: { method: "POST", urlTemplate: `${origin}/checkout` },
    };
    const { operations, warnings } = await verifyOperations([checkout, write], {
      replayer,
      now,
      haveSession: true,
      recordedRequests: [
        recorded("/api/checkout?delivery=standard"),
        recorded("/api/checkout?delivery=express"),
      ],
    });
    expect(operations).toEqual([write]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("verify: dropped");
    expect(calls).toHaveLength(4);
  });

  it("rejects successful samples from other endpoints, methods, origins and fixed query variants", async () => {
    const op = {
      ...checkout,
      request: {
        ...checkout.request,
        urlTemplate: `${origin}/api/checkout?format=json{&delivery}`,
      },
    };
    const { replayer, calls } = replay(() => 400);
    const { operations } = await verifyOperations([op], {
      replayer,
      now,
      haveSession: true,
      recordedRequests: [
        recorded("/api/search?format=json&delivery=standard"),
        recorded("/api/checkout?format=json&delivery=standard", { method: "POST" }),
        recorded("/api/checkout?format=json&delivery=standard", {
          url: "https://other.test/api/checkout?format=json&delivery=standard",
        }),
        recorded("/api/checkout?format=html&delivery=standard"),
        recorded("/api/checkout?format=json&delivery=standard", { blocked: true }),
        recorded("/api/checkout?format=json&delivery=standard", {
          resourceType: "replay-anonymous",
        }),
      ],
    });
    expect(operations).toEqual([]);
    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.url === `${origin}/api/checkout?format=json&delivery=canvas`)).toBe(
      true,
    );
  });
});
