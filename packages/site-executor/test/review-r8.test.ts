// AUTHORED-BY Codex GPT-6.1-Sol
import { toUSVString } from "node:util";
import type { CsrfRule, Operation, SiteModel } from "@jeswr/site-model";
import { parseActionRequest, validateSiteModel } from "@jeswr/site-model";
import { Parser } from "n3";
import { describe, expect, it, vi } from "vitest";
import { InMemorySessions } from "../src/cookies.js";
import { createExecutor, type ExecutionResult, type ExecutorOptions } from "../src/executor.js";
import { createApprovalGate } from "../src/gate.js";
import { secretRedactor } from "../src/secrets.js";

const O = "https://shop.test";
const S = "https://schema.org/";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
type Surface = "multipart" | "header" | "form" | "json" | "query" | "path";
type Transport = NonNullable<ExecutorOptions["fetch"]>;
const cases: { surface: Surface; source: string; transmitted: string }[] = [
  {
    surface: "multipart",
    source: "csrf-secret\nsecond-line",
    transmitted: "csrf-secret\r\nsecond-line",
  },
  {
    surface: "header",
    source: "  csrf-secret-with-padding  ",
    transmitted: "csrf-secret-with-padding",
  },
  { surface: "multipart", source: "csrf-usv-\ud800\nline", transmitted: "csrf-usv-\ufffd\r\nline" },
  { surface: "form", source: "csrf-usv-\ud800\nline", transmitted: "csrf-usv-\ufffd\nline" },
  { surface: "json", source: 'csrf-json-\ud800\n<&"', transmitted: 'csrf-json-\ud800\n<&"' },
  { surface: "query", source: 'csrf-query-\ud800 <&"', transmitted: 'csrf-query-\ufffd <&"' },
  { surface: "path", source: "csrf-path-\ud800 café", transmitted: "csrf-path-\ufffd café" },
];

function echoes(value: string): string[] {
  return [
    value,
    value.trim(),
    encodeURIComponent(toUSVString(value)),
    new URLSearchParams({ token: value }).toString().slice("token=".length),
    JSON.stringify(value).slice(1, -1),
    Array.from(value, (ch) => `&#${ch.codePointAt(0)};`).join(""),
  ];
}

function fixture(
  surface: Surface,
  source: string,
  transmitted: string,
  failure = false,
  display = transmitted,
) {
  const provenance = {
    derivedFrom: [],
    learnedAt: "2026-11-13",
    method: "manual" as const,
    confidence: 1,
  };
  const operation = (name: string, effect: Operation["effect"]): Operation => ({
    id: `urn:${name}`,
    label: name,
    actionType: `${S}ViewAction`,
    effect,
    session: "none",
    provenance,
    inputs: [],
    request: { method: effect === "read" ? "GET" : "POST", urlTemplate: `${O}/${name}` },
  });
  const prepare = operation("prepare", "reversible-write");
  const quote = operation("quote", "read");
  const pay = operation("pay", "payment");
  const finish = operation("finish", "reversible-write");
  // The error and committed-operation label must use the final secret set too.
  finish.label = `Finish ${display}`;
  const target: CsrfRule["target"] = {
    kind:
      surface === "header"
        ? "header"
        : surface === "path" || surface === "query"
          ? "query"
          : "form",
    name: "csrf_token",
  };
  pay.csrf = [{ source: { kind: "json", urlTemplate: `${O}/csrf`, pointer: "/token" }, target }];
  if (surface === "path") pay.request.urlTemplate += "/{csrf_token}";
  if (surface === "json") {
    pay.request.contentType = "application/json";
    pay.request.bodyTemplate = "{}";
  }
  if (surface === "multipart" || surface === "form")
    pay.request.contentType =
      surface === "multipart" ? "multipart/form-data" : "application/x-www-form-urlencoded";
  for (const op of [quote, pay])
    op.extraction = {
      format: "json",
      itemPath: "/items",
      itemType: `${S}Order`,
      idField: `${S}url`,
      fields: [
        { property: `${S}url`, path: "/url", datatype: "iri" },
        { property: `${S}price`, path: "/price" },
        { property: `${S}priceCurrency`, path: "/currency" },
        { property: `${S}name`, path: "/trusted" },
        { property: `${S}text`, path: "/untrusted", untrusted: true },
      ],
    };
  const model: SiteModel = {
    id: "urn:model",
    site: O,
    version: "1",
    generatedAt: "2026-11-13",
    operations: [prepare, quote, pay, finish],
    flows: [
      {
        id: "urn:buy",
        label: `Buy ${display}`,
        actionType: `${S}BuyAction`,
        effect: "payment",
        provenance,
        inputs: [],
        steps: [prepare, quote, pay, finish].map((op) => ({ operation: op.id, bind: {} })),
      },
    ],
  };
  expect(validateSiteModel(model)).toEqual([]);
  const allEchoes = [...echoes(source), ...echoes(transmitted)];
  const payload = (value: string, quote = false) =>
    Response.json({
      items: [
        {
          url: quote ? `${O}/order/104` : `${O}/order/${encodeURIComponent(toUSVString(value))}`,
          price: "20",
          currency: "GBP",
          trusted: [...allEchoes, "safe display text"],
          untrusted: allEchoes,
        },
      ],
    });
  const transport = vi.fn<Transport>(async (url, init) => {
    const request = new Request(String(url), init);
    const path = new URL(request.url).pathname;
    if (path === "/csrf") return Response.json({ token: source });
    if (path === "/quote") return payload(transmitted, true);
    if (path.startsWith("/pay")) {
      const actual =
        surface === "header"
          ? request.headers.get(target.name)
          : surface === "query"
            ? new URL(request.url).searchParams.get(target.name)
            : surface === "path"
              ? decodeURIComponent(path.split("/").at(-1) ?? "")
              : surface === "json"
                ? ((await request.json()) as Record<string, string>)[target.name]
                : (await request.formData()).get(target.name);
      expect(actual).toBe(transmitted);
      if (surface === "path") expect(path).toContain(encodeURIComponent(transmitted));
      return payload(String(actual));
    }
    if (path === "/finish" && failure) return new Response("", { status: 500 });
    return Response.json({});
  });
  const gate = createApprovalGate();
  const executor = createExecutor({
    model,
    sessions: new InMemorySessions(),
    gate,
    fetch: transport,
  });
  const request = parseActionRequest(`@prefix schema: <${S}>. [] a schema:BuyAction.`);
  const resume = async (result: ExecutionResult) => {
    expect(result.status, result.error).toBe("needs-approval");
    gate.approve(result.approval?.id ?? "");
    return executor.execute(request, { approvalId: result.approval?.id });
  };
  const assertClean = (result: ExecutionResult) => {
    const serialized = JSON.stringify(result);
    for (const value of allEchoes)
      expect(serialized).not.toContain(JSON.stringify(value).slice(1, -1));
    for (const observation of result.observations.filter((o) =>
      [quote.id, pay.id].includes(o.operation),
    )) {
      const quads = new Parser().parse(observation.turtle);
      const trusted = quads
        .filter((q) => q.predicate.value === `${S}name`)
        .map((q) => q.object.value);
      const untrusted = quads
        .filter((q) => q.predicate.value === `${RDF}value`)
        .map((q) => q.object.value);
      expect(trusted).toEqual([...allEchoes.map(() => "[redacted]"), "safe display text"]);
      expect(untrusted).toEqual(allEchoes.map(() => "[redacted]"));
    }
    if (result.approval) expect(result.approval.summary).toContain("[redacted]");
  };
  return { executor, request, transport, resume, assertClean };
}

describe("review r8 — transmitted token redaction", () => {
  it.each(
    cases,
  )("redacts $surface source and serialized tokens in trusted/untrusted echoes across approval pauses", async ({
    surface,
    source,
    transmitted,
  }) => {
    const f = fixture(surface, source, transmitted);
    const paymentApproval = await f.resume(await f.executor.execute(f.request));
    f.assertClean(paymentApproval);
    expect(paymentApproval.observations.some((o) => o.operation === "urn:quote")).toBe(true);
    const finishApproval = await f.resume(paymentApproval);
    f.assertClean(finishApproval);
    expect(finishApproval.observations.some((o) => o.operation === "urn:pay")).toBe(true);
    const done = await f.resume(finishApproval);
    expect(done.status, done.error).toBe("done");
    f.assertClean(done);
    expect(done.outcome?.result).toBeUndefined();
    expect(f.transport.mock.calls.filter(([url]) => String(url).includes("/pay"))).toHaveLength(1);
  });

  it.each(
    cases.slice(0, 2).flatMap((test) => [
      { ...test, encoding: "raw", display: test.transmitted },
      { ...test, encoding: "percent", display: encodeURIComponent(test.transmitted) },
      { ...test, encoding: "JSON", display: JSON.stringify(test.transmitted).slice(1, -1) },
      { ...test, encoding: "HTML", display: echoes(test.transmitted).at(-1) ?? "" },
    ]),
  )("redacts $surface $encoding echoes in summaries, errors and retained observations", async ({
    surface,
    source,
    transmitted,
    display,
  }) => {
    const f = fixture(surface, source, transmitted, true, display);
    const paymentApproval = await f.resume(await f.executor.execute(f.request));
    f.assertClean(paymentApproval);
    const finishApproval = await f.resume(paymentApproval);
    f.assertClean(finishApproval);
    const error = await f.resume(finishApproval);
    expect(error.status).toBe("error");
    expect(error.error).toContain("Finish [redacted]");
    f.assertClean(error);
  });

  it("redacts normalized vault headers before any approval or response", async () => {
    const secret = "  vault-secret-with-padding  ";
    const sessions = new InMemorySessions();
    sessions.set(O, undefined, { cookies: [], headers: { authorization: `Bearer ${secret}` } });
    // Use a minimal read so this also exercises session handling without any CSRF rule.
    const model: SiteModel = {
      id: "urn:vault",
      site: O,
      version: "1",
      generatedAt: "2026-11-13",
      flows: [],
      operations: [
        {
          id: "urn:read",
          label: secret.trim(),
          actionType: `${S}ViewAction`,
          inputs: [],
          effect: "read",
          session: "signed-in",
          provenance: { derivedFrom: [], learnedAt: "2026-11-13", method: "manual", confidence: 1 },
          request: { method: "GET", urlTemplate: `${O}/read` },
          extraction: {
            format: "json",
            itemType: `${S}Thing`,
            fields: [{ property: `${S}name`, path: "/echo" }],
          },
        },
      ],
    };
    const transport: Transport = async (url, init) => {
      const request = new Request(String(url), init);
      return Response.json({ echo: request.headers.get("authorization") });
    };
    const result = await createExecutor({ model, sessions, fetch: transport }).execute(
      parseActionRequest(`@prefix schema: <${S}>. [] a schema:ViewAction.`),
    );
    expect(result.status).toBe("done");
    expect(JSON.stringify(result)).not.toContain(secret.trim());
    expect(result.observations[0]?.turtle).toContain("[redacted]");
  });

  it("redacts eligible short forms while ignoring sub-four-character values", () => {
    const redact = secretRedactor(
      new Set([
        "",
        "          ",
        "abc",
        "1234567",
        "😀😀😀😀",
        "  tiny  ",
        "%61%62%63",
        "12345678",
      ]),
    );
    expect(redact("abc 1234567 tiny")).toBe("abc [redacted] [redacted]");
    expect(redact("12345678")).toBe("[redacted]");
    expect(redact("😀😀😀😀          ")).toBe("[redacted][redacted]");
    expect(redact("%61%62%63")).toBe("%61%62%63");
  });

  it("redacts mixed/nested percent, JSON and HTML escapes while preserving ordinary markup", () => {
    const token = 'csrf-<&"\\\n café-secret';
    const redact = secretRedactor(new Set([token]));
    const encoded = JSON.stringify(encodeURIComponent(token)).slice(1, -1);
    const jsonUnicode = Array.from(
      token,
      (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`,
    ).join("");
    const namedHtml = token
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll('"', "&quot;");
    for (const echo of [
      encoded,
      jsonUnicode,
      namedHtml,
      encodeURIComponent(namedHtml),
      JSON.stringify(namedHtml).slice(1, -1),
    ]) {
      expect(redact(`<b>visible</b> ${echo}`)).toBe("<b>visible</b> [redacted]");
    }
    expect(redact("<b>ordinary</b> &amp; text")).toBe("<b>ordinary</b> &amp; text");
  });
});
