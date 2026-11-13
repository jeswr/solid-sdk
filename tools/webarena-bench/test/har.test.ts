// AUTHORED-BY Claude Opus 5.5
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { captureHar } from "../src/har.js";
import type { Transport } from "../src/types.js";

const contract = JSON.parse(
  await readFile(new URL("./fixtures/har-contract.json", import.meta.url), "utf8"),
);
describe("HAR wire evidence", () => {
  it("retains evaluator fields, bodies and message cookies, redacts secrets only in HAR", async () => {
    const original = new Response('{"message":"added","authenticity_token":"response-secret"}', {
      status: 200,
      headers: { "Content-Type": "application/json", "Set-Cookie": "sid=session-secret; HttpOnly" },
    });
    original.headers.append("Set-Cookie", "mage-messages=added%20to%20wish%20list; Path=/");
    const transport: Transport = async (input) => {
      const request = new Request(input);
      expect(request.headers.get("cookie")).toBe("sid=session-secret");
      expect(await request.text()).toContain("password=login-secret");
      return original;
    };
    const recorder = captureHar(transport);
    const returned = await recorder.transport("https://shop.test/wishlist?form_key=url-secret", {
      method: "POST",
      headers: {
        Cookie: "sid=session-secret",
        Authorization: "Bearer fixture-secret",
        "Content-Type": "application/x-www-form-urlencoded",
        Referer: "https://shop.test/item/1",
      },
      body: "product=1&password=login-secret&form_key=csrf-secret",
    });
    expect(await returned.text()).toContain("response-secret");
    const entry = recorder.entries[0];
    for (const field of [...contract.entryFields, ...contract.postFields])
      expect(entry).toHaveProperty(field);
    expect(entry?.request.postData?.text).toBe(
      "product=1&password=%5Bredacted%5D&form_key=%5Bredacted%5D",
    );
    expect(entry?.response.cookies).toContainEqual({
      name: "mage-messages",
      value: "added%20to%20wish%20list",
    });
    expect(entry?.request.headers).toContainEqual({
      name: "referer",
      value: "https://shop.test/item/1",
    });
    const persisted = JSON.stringify(recorder.har());
    for (const secret of [
      "session-secret",
      "login-secret",
      "url-secret",
      "fixture-secret",
      "csrf-secret",
      "response-secret",
    ])
      expect(persisted).not.toContain(secret);
  });
  it("keeps JSON postData and actual redirect Location; marks real document requests", async () => {
    const transport: Transport = async () =>
      new Response(null, { status: 303, headers: { Location: "/product/1" } });
    const recorder = captureHar(transport);
    await recorder.transport("https://shop.test/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"title":"Example","nested":{"password":"secret"}}',
    });
    expect(recorder.entries[0]?.response.redirectURL).toBe("https://shop.test/product/1");
    expect(JSON.parse(recorder.entries[0]?.request.postData?.text ?? "")).toEqual({
      title: "Example",
      nested: { password: "[redacted]" },
    });
    await recorder.transport("https://shop.test/product/1", { headers: { Accept: "text/html" } });
    expect(recorder.entries[1]?.request.method).toBe(contract.navigation.method);
    expect(recorder.entries[1]?.request.headers).toContainEqual({
      name: "accept",
      value: contract.navigation.acceptStartsWith,
    });
  });
  it("preserves multipart fields for the reference parser, redacting credential fields", async () => {
    const recorder = captureHar(async () => new Response("ok"));
    const body = new FormData();
    body.set("title", "Fixture title");
    body.set("password", "multipart-secret");
    await recorder.transport("https://shop.test/create", { method: "POST", body });
    expect(recorder.entries[0]?.request.postData?.mimeType).toContain(
      "multipart/form-data; boundary=",
    );
    expect(recorder.entries[0]?.request.postData?.text).toContain("Fixture title");
    expect(recorder.entries[0]?.request.postData?.text).not.toContain("multipart-secret");
  });
  it("records failed actual requests; never fabricates a successful event", async () => {
    const recorder = captureHar(async () => {
      throw new Error("offline");
    });
    await expect(recorder.transport("https://shop.test/missing")).rejects.toThrow();
    expect(recorder.entries[0]?.response.status).toBe(0);
    expect(recorder.entries[0]?._capture_error).toContain("failed");
  });
  it("prevents requests after a task deadline", async () => {
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const recorder = captureHar(async () => {
      calls++;
      return new Response("ok");
    }, controller.signal);
    await expect(recorder.transport("https://shop.test/")).rejects.toThrow();
    expect(calls).toBe(0);
    expect(recorder.entries).toHaveLength(0);
  });
});
