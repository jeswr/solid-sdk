// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate

import { DataFactory, Writer } from "n3";
import { describe, expect, it } from "vitest";
import { listContainer } from "../src/container.js";

const { namedNode, quad } = DataFactory;
const BASE = "https://pod.example/kv/";
const LDP = "http://www.w3.org/ns/ldp#";
const RDF_TYPE = "http://www.w3.org/1999/02/22-rdf-syntax-ns#type";

async function turtle(quads: ReturnType<typeof quad>[]): Promise<string> {
  const writer = new Writer({ format: "text/turtle" });
  for (const q of quads) {
    writer.addQuad(q);
  }
  return new Promise<string>((resolve, reject) => {
    writer.end((err, result) => (err ? reject(err) : resolve(result)));
  });
}

function turtleFetch(body: string, status = 200): typeof globalThis.fetch {
  return (async () =>
    new Response(body, {
      status,
      headers: new Headers({ "content-type": "text/turtle" }),
    })) as typeof globalThis.fetch;
}

describe("listContainer", () => {
  it("returns null on 404", async () => {
    const fetchImpl = (async () => new Response(null, { status: 404 })) as typeof globalThis.fetch;
    expect(await listContainer(BASE, BASE, fetchImpl)).toBeNull();
  });

  it("returns null on 410", async () => {
    const fetchImpl = (async () => new Response(null, { status: 410 })) as typeof globalThis.fetch;
    expect(await listContainer(BASE, BASE, fetchImpl)).toBeNull();
  });

  it("throws on a non-2xx (non-404) status", async () => {
    const fetchImpl = (async () =>
      new Response(null, { status: 500, statusText: "boom" })) as typeof globalThis.fetch;
    await expect(listContainer(BASE, BASE, fetchImpl)).rejects.toThrow(/failed: 500/);
  });

  it("returns [] for a document with no container subject", async () => {
    const body = await turtle([
      quad(namedNode(`${BASE}x`), namedNode(RDF_TYPE), namedNode("http://schema.org/Thing")),
    ]);
    expect(await listContainer(BASE, BASE, turtleFetch(body))).toEqual([]);
  });

  it("lists members and flags containers", async () => {
    const body = await turtle([
      quad(namedNode(BASE), namedNode(RDF_TYPE), namedNode(`${LDP}BasicContainer`)),
      quad(namedNode(BASE), namedNode(`${LDP}contains`), namedNode(`${BASE}a`)),
      quad(namedNode(BASE), namedNode(`${LDP}contains`), namedNode(`${BASE}sub/`)),
      quad(namedNode(`${BASE}sub/`), namedNode(RDF_TYPE), namedNode(`${LDP}Container`)),
    ]);
    const members = await listContainer(BASE, BASE, turtleFetch(body));
    expect(members).not.toBeNull();
    const byUrl = new Map(members?.map((m) => [m.url, m.container]));
    expect(byUrl.get(`${BASE}a`)).toBe(false);
    expect(byUrl.get(`${BASE}sub/`)).toBe(true);
  });

  it("skips a member that escapes the driver base (hostile server)", async () => {
    const body = await turtle([
      quad(namedNode(BASE), namedNode(RDF_TYPE), namedNode(`${LDP}BasicContainer`)),
      quad(namedNode(BASE), namedNode(`${LDP}contains`), namedNode(`${BASE}ok`)),
      quad(namedNode(BASE), namedNode(`${LDP}contains`), namedNode("https://evil.example/x")),
      quad(
        namedNode(BASE),
        namedNode(`${LDP}contains`),
        namedNode("https://pod.example/outside/y"),
      ),
    ]);
    const members = await listContainer(BASE, BASE, turtleFetch(body));
    expect(members?.map((m) => m.url)).toEqual([`${BASE}ok`]);
  });

  it("skips a member equal to the container itself", async () => {
    const body = await turtle([
      quad(namedNode(BASE), namedNode(RDF_TYPE), namedNode(`${LDP}BasicContainer`)),
      quad(namedNode(BASE), namedNode(`${LDP}contains`), namedNode(BASE)),
      quad(namedNode(BASE), namedNode(`${LDP}contains`), namedNode(`${BASE}real`)),
    ]);
    const members = await listContainer(BASE, BASE, turtleFetch(body));
    expect(members?.map((m) => m.url)).toEqual([`${BASE}real`]);
  });
});
