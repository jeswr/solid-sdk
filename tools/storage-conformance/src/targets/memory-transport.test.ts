// AUTHORED-BY Codex GPT-6.1-Sol
import { expect, test } from "vitest";
import { memoryTarget } from "./memory.js";

test("Solid reference transport enforces create-only and observed-validator PUTs", async () => {
  const target = await memoryTarget("solid").start();
  const url = `${target.root}transport.json`;
  const create = () =>
    target.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "If-None-Match": "*" },
      body: '{"theme":"system"}',
    });
  const created = await create();
  expect(created.status).toBe(201);
  const etag = created.headers.get("etag") as string;
  expect(etag).toBeTruthy();
  expect((await create()).status).toBe(412);
  expect((await target.fetch(url, { method: "PUT", body: "unconditional" })).status).toBe(428);
  expect(
    (
      await target.fetch(url, {
        method: "PUT",
        headers: { "If-Match": etag, "Content-Type": "application/json" },
        body: '{"theme":"dark"}',
      })
    ).status,
  ).toBe(204);
  expect(
    (
      await target.fetch(url, {
        method: "PUT",
        headers: { "If-Match": etag },
        body: "stale",
      })
    ).status,
  ).toBe(412);
  expect(await (await target.fetch(url)).json()).toEqual({ theme: "dark" });
  expect((await target.fetch(`${target.root}absent`)).status).toBe(404);
  expect((await target.fetch(url, { method: "DELETE" })).status).toBe(405);
  await expect(target.fetch(url, { signal: AbortSignal.abort() })).rejects.toThrow();
});

test("LWS reference transport serves TypeIndex bytes and refuses malformed QUERY or create PUT", async () => {
  const target = await memoryTarget("lws").start();
  const { indexEndpoint, searchEndpoint } = target.storage.features.typeIndex.detail;
  if (!indexEndpoint || !searchEndpoint) throw new Error("Missing services");
  for (const type of ["bytes", "blob"] as const) {
    const read = await target.storage.read(indexEndpoint);
    const result =
      type === "bytes"
        ? new TextDecoder().decode(await read.bytes())
        : await (await read.blob()).text();
    expect(JSON.parse(result)).toEqual({ type: "TypeIndex", items: [] });
  }
  expect(
    (
      await target.fetch(searchEndpoint, {
        method: "QUERY",
        body: '{"type":[]}',
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await target.fetch(searchEndpoint, {
        method: "PUT",
        headers: { "If-None-Match": "*" },
        body: "",
      })
    ).status,
  ).toBe(405);
});
