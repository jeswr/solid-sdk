// AUTHORED-BY Codex (GPT-6.1 Sol)

import { resolveStorageDescription } from "@jeswr/storage-capabilities";
import { createMemoryCache } from "@jeswr/storage-capabilities/cache";
import { NS } from "@jeswr/suite-vocab";
import {
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  RequiredAs,
  SetFrom,
  TermWrapper,
} from "@rdfjs/wrapper";
import { DataFactory, Store, Writer } from "n3";
import type { PodSession } from "@/lib/session/pod-session";

/** The shared demo fixture has no storageDescription Link; seed that known fixture metadata. */
export async function askSearchCapabilities(session: PodSession, signal: AbortSignal) {
  const cache = createMemoryCache();
  if (session.mode === "demo") {
    const response = await session.fetch(session.storageUrl, { method: "HEAD", signal });
    if (!response.ok) throw new Error("Couldn't open the sample pod");
    const headers = new Headers(response.headers);
    headers.append("Link", `<${session.storageUrl}>; rel="${NS.SOLID}storageDescription"`);
    await resolveStorageDescription(session.storageUrl, {
      fetch: session.fetch,
      seedHeaders: headers,
      cache,
      signal,
    });
  }
  return cache;
}

/** Standard-vocabulary demo notes, compatible with Notes and written only into the demo pod. */
export async function ensureAskSample(session: PodSession): Promise<void> {
  if (session.mode !== "demo") return;
  for (const [slug, title, text] of [
    [
      "passport",
      "Passport renewal",
      "My passport expires on 18 September 2028. I should start the renewal in March 2028.",
    ],
    [
      "garden",
      "Garden agreement with Rowan",
      "Rowan and I agreed to plant the garden's north border with lavender on Saturday 14 November. Rowan will bring the plants and I will prepare the soil.",
    ],
    [
      "trip",
      "Autumn travel checklist",
      "For the autumn trip, check the passport expiry date before booking. The train booking reference is FICTION-42.",
    ],
  ]) {
    const url = new URL(`notes/ask-sample-${slug}.ttl`, session.storageUrl).href;
    const dataset = new Store();
    const subject = new TermWrapper(`${url}#it`, dataset, DataFactory);
    RequiredAs.object(
      subject,
      `${NS.RDF}type`,
      `${NS.SCHEMA}TextDigitalDocument`,
      NamedNodeFrom.string,
    );
    SetFrom.subjectPredicate(
      subject,
      `${NS.RDF}type`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    ).add(`${NS.POD_DOCS}Document`);
    RequiredAs.object(subject, `${NS.POD_DOCS}body`, text as string, LiteralFrom.string);
    RequiredAs.object(subject, `${NS.POD_DOCS}format`, "text/plain", LiteralFrom.string);
    RequiredAs.object(
      subject,
      "http://purl.org/dc/terms/title",
      title as string,
      LiteralFrom.string,
    );
    RequiredAs.object(
      subject,
      "http://purl.org/dc/terms/description",
      text as string,
      LiteralFrom.string,
    );
    RequiredAs.object(
      subject,
      "http://purl.org/dc/terms/modified",
      new Date("2026-11-10T10:00:00Z"),
      LiteralFrom.dateTime,
    );
    const writer = new Writer({ format: "text/turtle" });
    writer.addQuads([...dataset]);
    const body = await new Promise<string>((resolve, reject) =>
      writer.end((error, result) => (error ? reject(error) : resolve(result))),
    );
    const response = await session.fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "text/turtle", "If-None-Match": "*" },
      body,
    });
    if (!response.ok && response.status !== 412)
      throw new Error("Couldn't prepare Ask's sample documents");
  }
}
