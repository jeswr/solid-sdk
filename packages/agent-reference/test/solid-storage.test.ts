// AUTHORED-BY Codex GPT-6
import { readContainerMembers } from "@jeswr/ldp-container";
import { describe, expect, it } from "vitest";
import { digestBytes } from "../src/core/canonical.js";
import { DEFAULT_LIMITS } from "../src/core/limits.js";
import { signCompact, verifyCompact } from "../src/mechanisms/jws.js";
import { accessDocument } from "../src/model/solid-storage.js";
import { testKey } from "../src/reference/keys.js";
import { FictionalSolidStorage } from "../src/standins/storage.js";

const origin = "https://fictional-storage.example";
const owner = "https://sam.example/agent";
const reader = "https://northbank.example/agent";
async function fixture() {
  const [serverKey, ownerKey, readerKey] = await Promise.all([
    testKey("solid-provider"),
    testKey("solid-owner"),
    testKey("solid-reader"),
  ]);
  const storage = new FictionalSolidStorage(
    origin,
    `${origin}/#provider`,
    serverKey,
    () => "2026-11-14T00:00:00Z",
  );
  storage.introduce(owner, ownerKey);
  storage.introduce(reader, readerKey);
  await storage.provision(`${origin}/`, owner, { container: true });
  await storage.provision(`${origin}/inbox/`, owner, {
    container: true,
    rules: [{ resource: `${origin}/inbox/`, agent: reader, modes: ["Append"] }],
  });
  return {
    storage,
    ownerFetch: storage.client(owner, ownerKey),
    readerFetch: storage.client(reader, readerKey),
    serverKey,
  };
}
describe("fictional Solid storage", () => {
  it("binds signed requests to the exact request and rejects malformed claims and replay", async () => {
    const { storage, ownerFetch } = await fixture();
    const readerKey = await testKey("solid-reader");
    const target = `${origin}/inbox/`;
    const body = "A signed request body";
    const payload = {
      actor: reader,
      method: "POST",
      url: target,
      body: digestBytes(body),
      headers: JSON.stringify([
        ["content-type", "text/plain"],
        ["slug", null],
        ["if-match", null],
        ["if-none-match", null],
      ]),
      at: "2026-11-14T00:00:00Z",
      nonce: "the-request-nonce",
    };
    const signed = await signCompact(readerKey, "fictional-solid-http+jws", payload);
    const send = (token: string, text = body, slug?: string) =>
      storage.handle(
        new Request(target, {
          method: "POST",
          body: text,
          headers: {
            authorization: `FictionalSignature ${token}`,
            "content-type": "text/plain",
            ...(slug ? { slug } : {}),
          },
        }),
      );
    for (const claim of [
      null,
      [],
      { ...payload, nonce: {} },
      { ...payload, nonce: [] },
      { ...payload, nonce: "" },
      { ...payload, at: "not-a-time" },
    ]) {
      const token = await signCompact(readerKey, "fictional-solid-http+jws", claim);
      expect((await send(token)).status).toBe(401);
      expect((await send(token)).status).toBe(401);
    }
    expect((await send(signed, "A substituted body")).status).toBe(401);
    expect((await send(signed, body, "substituted-slug")).status).toBe(401);
    expect(await readContainerMembers(ownerFetch, target, { scope: `${origin}/` })).toEqual([]);
    expect((await send(signed)).status).toBe(201);
    expect((await send(signed)).status).toBe(401);
    expect(await readContainerMembers(ownerFetch, target, { scope: `${origin}/` })).toHaveLength(1);
  });

  it("creates, lists and reads exact bytes under independently verified identities", async () => {
    const { storage, ownerFetch, readerFetch, serverKey } = await fixture();
    const body = '{"signed":"opaque bytes"}\n';
    const posted = await readerFetch(`${origin}/inbox/`, {
      method: "POST",
      headers: { "content-type": "application/ld+json", slug: "message" },
      body,
    });
    expect(posted.status).toBe(201);
    const url = posted.headers.get("location") as string;
    expect((await readerFetch(url)).status).toBe(403);
    expect((await readerFetch(`${origin}/inbox/`)).status).toBe(403);
    const listed = await readContainerMembers(ownerFetch, `${origin}/inbox/`, {
      scope: `${origin}/`,
    });
    expect(listed?.map((member) => member.url)).toContain(url);
    const response = await ownerFetch(url);
    expect(await response.text()).toBe(body);
    expect(response.headers.get("wac-allow")).toContain('user="read write append control"');
    const receipt = await verifyCompact(
      response.headers.get("x-fictional-storage-receipt") as string,
      {
        typ: "fictional-solid-response+jws",
        allowedAlgs: ["EdDSA"],
        limits: DEFAULT_LIMITS,
        resolve: (kid) => (kid === serverKey.kid ? serverKey : undefined),
      },
    );
    expect(receipt.outcome).toBe("valid");
    expect(
      storage.accessLog.some((log) => log.actor === owner && log.url === url && log.status === 200),
    ).toBe(true);
    expect((await ownerFetch(url, { method: "PUT", body: "replacement" })).status).toBe(204);
    expect(await (await ownerFetch(url)).text()).toBe("replacement");
    expect((await ownerFetch(url, { method: "DELETE" })).status).toBe(204);
    expect((await ownerFetch(url)).status).toBe(404);
  });
  it("refuses append-only ACL minting, overwrite, deletion and forged credentials", async () => {
    const { storage, ownerFetch, readerFetch } = await fixture();
    for (const slug of ["secret.acl", "secret.ACL", "../secret", "..", "a%2Facl"])
      expect(
        (
          await readerFetch(`${origin}/inbox/`, {
            method: "POST",
            headers: { slug },
            body: "attack",
          })
        ).status,
      ).toBe(409);
    await ownerFetch(`${origin}/inbox/private`, { method: "PUT", body: "secret" });
    for (const method of ["PUT", "DELETE"])
      expect(
        (
          await readerFetch(`${origin}/inbox/private`, {
            method,
            body: method === "PUT" ? "attack" : undefined,
          })
        ).status,
      ).toBe(403);
    expect(
      (await readerFetch(`${origin}/inbox/private.acl`, { method: "PUT", body: "" })).status,
    ).toBe(403);
    expect(
      (
        await storage.handle(
          new Request(`${origin}/inbox/private`, {
            headers: { authorization: "FictionalSignature forged" },
          }),
        )
      ).status,
    ).toBe(401);
    expect((await storage.client()(`${origin}/inbox/private`)).status).toBe(401);
  });
  it("uses the nearest ACL and never unions ancestor permissions or Control with Read", async () => {
    const { storage, ownerFetch, readerFetch } = await fixture();
    await ownerFetch(`${origin}/inbox/private`, { method: "PUT", body: "secret" });
    const acl = await accessDocument(`${origin}/inbox/private.acl`, [
      { resource: `${origin}/inbox/private`, agent: reader, modes: ["Control"] },
    ]);
    expect(
      (
        await ownerFetch(`${origin}/inbox/private.acl`, {
          method: "PUT",
          headers: { "content-type": "text/turtle" },
          body: acl,
        })
      ).status,
    ).toBe(201);
    expect((await ownerFetch(`${origin}/inbox/private`)).status).toBe(403);
    expect((await readerFetch(`${origin}/inbox/private`)).status).toBe(403);
    expect((await readerFetch(`${origin}/inbox/private.acl`)).status).toBe(200);
    expect((await storage.client()(`${origin}/missing`)).status).toBe(401);
  });
  it("guards private destinations, unknown hosts and bounded bodies", async () => {
    const { storage, ownerFetch } = await fixture();
    for (const url of [
      "https://127.0.0.1/",
      "https://10.0.0.1/",
      "https://169.254.169.254/",
      "https://elsewhere.example/",
    ])
      await expect(ownerFetch(url)).rejects.toThrow();
    await storage.provision(`${origin}/large`, owner, { body: "x".repeat(1024) });
    await expect(
      storage.client(owner, await testKey("solid-owner"), 100)(`${origin}/large`),
    ).rejects.toThrow();
    expect(
      (
        await ownerFetch(`${origin}/large`, {
          method: "PUT",
          headers: { "if-match": '"wrong"' },
          body: "changed",
        })
      ).status,
    ).toBe(412);
  });
});
