// AUTHORED-BY Codex GPT-6.1-Sol
import { DataFactory, Store } from "n3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryChannelAdapter } from "./channel.js";
import { importInbound } from "./import.js";

const CONTAINER = "https://pod.example/inbox/";
const ACL = `${CONTAINER}owner-policy`;
const MAX_BYTES = 1024 * 1024;
const WAC = `<#owner> a <http://www.w3.org/ns/auth/acl#Authorization> ;
  <http://www.w3.org/ns/auth/acl#accessTo> <${CONTAINER}> .\n`;

function pod(response: Response) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (_input, init) => {
    if (init?.method === "HEAD")
      return new Response(null, { headers: { link: '<owner-policy>; rel="acl"' } });
    if (init?.method === "GET") return response;
    return new Response(null, { status: 201 });
  });
  const adapter = new InMemoryChannelAdapter("email", []);
  const pull = vi.spyOn(adapter, "pullInbound");
  const run = () =>
    importInbound({
      adapter,
      writeFetch: fetch,
      container: CONTAINER,
      ownerWebId: "https://pod.example/profile/card#me",
    });
  const expectNoWrites = () => {
    expect(fetch.mock.calls.map(([, init]) => init?.method)).toEqual(["HEAD", "GET"]);
    expect(pull).not.toHaveBeenCalled();
  };
  return { fetch, run, expectNoWrites };
}

function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}, close = true) {
  const cancel = vi.fn();
  let next = 0;
  const pull = vi.fn((controller: ReadableStreamDefaultController<Uint8Array>) => {
    const chunk = chunks[next++];
    if (chunk !== undefined) controller.enqueue(chunk);
    else if (close) controller.close();
  });
  const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
  const response = new Response(body, {
    headers: { "content-type": "text/turtle; charset=utf-8", ...headers },
  });
  const text = vi.spyOn(response, "text");
  return { response, cancel, pull, text };
}

afterEach(() => vi.restoreAllMocks());

describe("ACL validation response and parser budgets", () => {
  it.each([
    undefined,
    "1",
  ])("cancels an oversized stream with Content-Length %s", async (length) => {
    const first = Buffer.from(`${WAC}#${" ".repeat(MAX_BYTES / 2)}`);
    const source = streamed(
      [first, Buffer.alloc(MAX_BYTES / 2, 32), Buffer.from("unread")],
      length === undefined ? {} : { "content-length": length },
      false,
    );
    const check = pod(source.response);
    await expect(check.run()).rejects.toThrow(/ACL.*budget/);
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(source.pull).toHaveBeenCalledTimes(2);
    expect(source.text).not.toHaveBeenCalled();
    check.expectNoWrites();
  });

  it("rejects an oversized declared body before reading", async () => {
    const source = streamed([], { "content-length": String(MAX_BYTES + 1) }, false);
    const check = pod(source.response);
    await expect(check.run()).rejects.toThrow(/ACL.*budget/);
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(source.pull).not.toHaveBeenCalled();
    check.expectNoWrites();
  });

  it("counts UTF-8 bytes rather than decoded characters", async () => {
    const source = streamed([Buffer.from(`${WAC}#${"é".repeat(MAX_BYTES / 2)}`)], {}, false);
    const check = pod(source.response);
    await expect(check.run()).rejects.toThrow(/ACL.*budget/);
    expect(source.cancel).toHaveBeenCalledOnce();
    check.expectNoWrites();
  });

  it("accepts the byte boundary without calling text()", async () => {
    const source = streamed([
      Buffer.from(`${WAC}#${" ".repeat(MAX_BYTES - Buffer.byteLength(WAC) - 1)}`),
    ]);
    const check = pod(source.response);
    await expect(check.run()).resolves.toMatchObject({ written: 0 });
    expect(check.fetch.mock.calls.at(-1)?.[0]).toBe(ACL);
    expect(source.cancel).not.toHaveBeenCalled();
    expect(source.text).not.toHaveBeenCalled();
  });

  it("decodes split UTF-8 and validates statements preceding a non-ASCII EOF comment", async () => {
    const bytes = Buffer.from(`${WAC}<urn:s> <urn:p> "café 🌱" . # é`);
    const source = streamed([...bytes].map((byte) => Uint8Array.of(byte)));
    const check = pod(source.response);
    await expect(check.run()).resolves.toMatchObject({ written: 0 });
    expect(source.text).not.toHaveBeenCalled();
  });

  it.each([
    [
      "prefix term creation",
      `@prefix x: <urn:${"x".repeat(4096)}> .\n${"x:s x:p x:o .\n".repeat(200)}`,
    ],
    [
      "reused expanded terms",
      `@prefix x: <urn:${"x".repeat(4096)}> .\nx:s x:p ${Array.from({ length: 300 }, () => "x:o").join(",")} .`,
    ],
    ["quad count including duplicates", "<s:> <p:> <o:> .\n".repeat(16_384)],
    ["base resolution work without quads", "@base <> .\n".repeat(1500)],
    ["generated list nodes", `<urn:s> <urn:p> (${'"" '.repeat(15_000)}) .`],
    ["repeated empty structures", "<urn:s> <urn:p> [] .\n".repeat(10_000)],
  ])("cancels on %s before validation or a stalled tail", async (_kind, source) => {
    expect(Buffer.byteLength(source)).toBeLessThan(MAX_BYTES);
    const input = streamed([Buffer.from(WAC + source)], {}, false);
    const check = pod(input.response);
    await expect(check.run()).rejects.toThrow(/ACL.*budget/);
    expect(input.cancel).toHaveBeenCalledOnce();
    expect(input.pull).toHaveBeenCalledOnce();
    expect(input.text).not.toHaveBeenCalled();
    check.expectNoWrites();
  });

  it("accepts exactly 16,384 input quads including duplicates", async () => {
    const source = streamed([Buffer.from(WAC + "<s:> <p:> <o:> .\n".repeat(16_382))]);
    await expect(pod(source.response).run()).resolves.toMatchObject({ written: 0 });
  });

  it.each([
    ["response bytes", `${WAC}#${" ".repeat(MAX_BYTES)}`],
    ["duplicate quads", WAC + "<s:> <p:> <o:> .\n".repeat(16_383)],
    [
      "expanded quad bytes",
      `${WAC}@prefix x: <urn:${"x".repeat(4096)}> .\nx:s x:p ${Array.from({ length: 300 }, () => "x:o").join(",")} .`,
    ],
    ["base work", `${WAC}${"@base <> .\n".repeat(1500)}`],
  ])("fails closed for a complete document exceeding %s", async (_kind, body) => {
    const check = pod(new Response(body, { headers: { "content-type": "text/turtle" } }));
    await expect(check.run()).rejects.toThrow(/ACL.*budget/);
    check.expectNoWrites();
  });

  it("charges unused expanded prefix declarations before quads", async () => {
    const source = `@base <urn:${"x".repeat(900)}> .\n${"@prefix unused: <> .\n".repeat(300)}`;
    const input = streamed([Buffer.from(source)], {}, false);
    const add = vi.spyOn(Store.prototype, "addQuad");
    const check = pod(input.response);
    await expect(check.run()).rejects.toThrow(/ACL.*budget/);
    expect(add).not.toHaveBeenCalled();
    expect(input.cancel).toHaveBeenCalledOnce();
    check.expectNoWrites();
  });

  it("cancels before constructing a parser with an over-budget initial base", async () => {
    const source = streamed([], {}, false);
    const check = pod(source.response);
    check.fetch.mockImplementationOnce(
      async () => new Response(null, { headers: { link: `<${"x".repeat(1024)}>; rel="acl"` } }),
    );
    await expect(check.run()).rejects.toThrow(/ACL.*budget/);
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(source.pull).not.toHaveBeenCalled();
    check.expectNoWrites();
  });

  it("does not await a stalled cancellation hook", async () => {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
      headers: { "content-type": "text/turtle", "content-length": String(MAX_BYTES + 1) },
    });
    const check = pod(response);
    await expect(check.run()).rejects.toThrow(/ACL.*budget/);
    expect(cancel).toHaveBeenCalledOnce();
    check.expectNoWrites();
  });

  it("refuses a nonstream response shim without falling back to text()", async () => {
    const text = vi.fn(async () => WAC);
    const response = {
      ok: true,
      status: 200,
      headers: new Headers({ "content-type": "text/turtle" }),
      text,
    } as unknown as Response;
    const check = pod(response);
    await expect(check.run()).rejects.toThrow(/ACL response body.*stream/);
    expect(text).not.toHaveBeenCalled();
    check.expectNoWrites();
  });

  it("preserves an empty native response", async () => {
    const response = new Response(null, { headers: { "content-type": "text/turtle" } });
    await expect(pod(response).run()).resolves.toMatchObject({ written: 0 });
  });

  it.each([
    ["blank nodes", (n: number) => `${"[ <urn:p> ".repeat(n)}"leaf"${"]".repeat(n)}`],
    ["collections", (n: number) => `${"(".repeat(n)}"leaf"${")".repeat(n)}`],
    ["triple terms", (n: number) => `${"<<( <urn:s> <urn:p> ".repeat(n)}<urn:o>${")>>".repeat(n)}`],
    [
      "reified triples",
      (n: number) => `${"<< ".repeat(n)}<urn:s>${" <urn:p> <urn:o> >>".repeat(n)}`,
    ],
  ])("accepts 64 nested %s and cancels before a 65th context", async (_kind, nested) => {
    const source = (depth: number) => `${WAC}<urn:s> <urn:p> ${nested(depth)} .`;
    const accepted = streamed([Buffer.from(source(64))]);
    await expect(pod(accepted.response).run()).resolves.toMatchObject({ written: 0 });
    const node = vi.spyOn(DataFactory, "blankNode");
    const add = vi.spyOn(Store.prototype, "addQuad");
    const refused = streamed([Buffer.from(source(65))], {}, false);
    const check = pod(refused.response);
    await expect(check.run()).rejects.toThrow(/ACL.*budget/);
    expect(refused.cancel).toHaveBeenCalledOnce();
    expect(node.mock.calls.length).toBeLessThanOrEqual(64);
    expect(add).toHaveBeenCalledTimes(2); // Only the WAC preamble reached the dataset.
    check.expectNoWrites();
  });

  it.each([
    "<urn:s> <urn:p>",
    '<urn:s> <urn:p> "x" . é',
  ])("rejects incomplete or malformed EOF: %s", async (tail) => {
    const source = streamed([Buffer.from(WAC + tail)]);
    const check = pod(source.response);
    await expect(check.run()).rejects.toThrow();
    check.expectNoWrites();
  });

  it("propagates stream read failures before any write", async () => {
    const failure = new Error("synthetic read failure");
    const response = new Response(
      new ReadableStream({
        pull(controller) {
          controller.error(failure);
        },
      }),
      { headers: { "content-type": "text/turtle" } },
    );
    const check = pod(response);
    await expect(check.run()).rejects.toThrow(failure);
    check.expectNoWrites();
  });
});
