// AUTHORED-BY Claude Opus 5.5
import { type AuditRead, monthlyAuditSource } from "@jeswr/mcp-connections";
import { DataFactory as df, Writer } from "n3";
import { expect, it } from "vitest";
import { auditSpecialRead } from "../src/audit.js";
import type { PodPort } from "../src/pod-port.js";
import { createWacMemoryPodPort } from "./wac-memory-pod.js";

const ROOT = "https://example.org/pod/";
const OWNER = `${ROOT}profile/card#me`;
const PD = "https://w3id.org/dpv/pd#";
const LDP = "http://www.w3.org/ns/ldp#";
const decoder = new TextDecoder();

/** The suite's reader sees what an owner session would: listings as Turtle, files as stored. */
function ownerRead(pod: PodPort): AuditRead {
  return async (url) => {
    if (url.endsWith("/")) {
      const writer = new Writer();
      for (const child of await pod.list(url))
        writer.addQuad(df.namedNode(url), df.namedNode(`${LDP}contains`), df.namedNode(child.url));
      const text = await new Promise<string>((resolve, reject) =>
        writer.end((error, result) => (error ? reject(error) : resolve(result))),
      );
      return { text, contentType: "text/turtle" };
    }
    const read = await pod.read(url);
    return { text: decoder.decode(read.body), contentType: read.contentType || "text/turtle" };
  };
}

it("the Settings reader shows every entry the MCP writer records, including URN clients", async () => {
  const pod = createWacMemoryPodPort({ root: ROOT, webId: OWNER });
  await auditSpecialRead(pod, false, "https://mcp.example/clients/abc", "ServiceProvision", [
    `${PD}MedicalHealth`,
  ]);
  await auditSpecialRead(pod, false, "urn:example:embedded-client", "Personalisation", [
    `${PD}Financial`,
    `${PD}Contact`,
  ]);
  // Ordinary personal data is not audited, so it never reaches the view.
  await auditSpecialRead(pod, false, "https://mcp.example/clients/abc", "Personalisation", [
    `${PD}Contact`,
  ]);
  const rows = await monthlyAuditSource.list(ownerRead(pod), ROOT, 100);
  expect(rows).toHaveLength(2);
  expect(rows).toContainEqual(
    expect.objectContaining({
      client: "https://mcp.example/clients/abc",
      purpose: "https://w3id.org/dpv#ServiceProvision",
      categories: [`${PD}MedicalHealth`],
      source: "monthly",
    }),
  );
  const urn = rows.find((row) => row.categories.includes(`${PD}Financial`));
  expect(urn).toBeDefined();
  expect(urn).not.toHaveProperty("client");
  expect(urn?.categories).toEqual([`${PD}Financial`]);
  for (const row of rows) expect(Number.isFinite(Date.parse(row.at))).toBe(true);
});
