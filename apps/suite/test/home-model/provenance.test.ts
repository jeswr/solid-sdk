// AUTHORED-BY Codex GPT-6.1-Sol
import { describe, expect, it } from "vitest";
import {
  CONNECTORS,
  connectorForUrl,
  type ProvenanceContext,
  provenanceOf,
} from "../../src/apps/home/lib/model/provenance";
import { rdf, STORAGE, WEB_ID } from "./fixtures";

describe("Home §5.3 provenance", () => {
  const subject = `${STORAGE}item.ttl#it`;
  const app = "https://app.example/client.jsonld";
  const person = "https://bob.example/profile#me";
  const context: ProvenanceContext = {
    userWebId: WEB_ID,
    storage: STORAGE,
    identities: new Map([
      [app, { kind: "app", label: "MyHealth" }],
      [person, { kind: "person", label: "Bob" }],
      ["https://blank.example/", { kind: "app", label: " " }],
    ]),
  };

  it("rule 1: recognises connector sources ahead of attributed agents and folders", async () => {
    const dataset = await rdf(
      `<#it> old:url "broken", <https://unknown.example/>, <https://open.spotify.com/track/1> ; prov:wasAttributedTo <${app}> .`,
    );
    expect(provenanceOf(dataset, subject, `${STORAGE}integrations/github/`, context)).toEqual({
      kind: "source",
      label: "Spotify",
      logoId: "spotify",
    });
  });

  it.each([
    "wasAttributedTo",
    "wasGeneratedBy",
  ])("rule 2: resolves %s app and person names", async (predicate) => {
    for (const [iri, kind, label] of [
      [app, "app", "MyHealth"],
      [person, "source", "Bob"],
    ]) {
      const dataset = await rdf(`<#it> prov:${predicate} <${iri}> .`);
      expect(provenanceOf(dataset, subject, `${STORAGE}integrations/spotify/`, context)).toEqual({
        kind,
        label,
      });
    }
  });

  it("rule 3: uses the connector folder when attribution is self, unresolved or nameless", async () => {
    const dataset = await rdf(
      `<#it> schema:url <https://unlisted.example/> ; prov:wasAttributedTo <${WEB_ID}>, <https://unknown.example/>, <https://blank.example/> .`,
    );
    expect(
      provenanceOf(dataset, subject, `${STORAGE}integrations/netflix/collection.ttl`, context),
    ).toEqual({ kind: "source", label: "Netflix", logoId: "netflix" });
    expect(provenanceOf(dataset, subject, `${STORAGE}integrations/github/`)).toMatchObject({
      label: "GitHub",
    });
    expect(provenanceOf(dataset, subject, `${STORAGE}integrations/unknown/`, context)).toEqual({
      kind: "you",
      label: "Added by you",
    });
  });

  it("rule 4: hand-added notes have Added by you; ignores forged or invalid folders", async () => {
    const dataset = await rdf("<#it> a schema:TextDigitalDocument .");
    for (const container of [
      `${STORAGE}notes/`,
      "bad",
      "https://foreign.example/integrations/spotify/",
      `${STORAGE}integrations/spotify`,
    ]) {
      expect(provenanceOf(dataset, subject, container, context)).toEqual({
        kind: "you",
        label: "Added by you",
      });
    }
    expect(provenanceOf(dataset, subject, STORAGE)).toEqual({ kind: "you", label: "Added by you" });
  });

  it("ports all connector host patterns and protects host boundaries", () => {
    expect(CONNECTORS).toHaveLength(30);
    for (const connector of CONNECTORS) {
      for (const host of connector.hosts) {
        expect(connectorForUrl(`https://${host}/item`)?.id).toBe(connector.id);
        expect(connectorForUrl(`https://sub.${host}/item`)?.id).toBe(connector.id);
        expect(connectorForUrl(`https://${host}.evil.example/item`)).toBeUndefined();
      }
    }
    expect(connectorForUrl("https://www.google.com/calendar/event?eid=1")?.id).toBe(
      "google-calendar",
    );
    expect(connectorForUrl("https://google.com/calendar")?.id).toBe("google-calendar");
    expect(connectorForUrl("https://google.com/calendar-evil")).toBeUndefined();
    expect(connectorForUrl("https://google.com/search")).toBeUndefined();
    expect(connectorForUrl("https://OPEN.SPOTIFY.COM:443/track/1")?.id).toBe("spotify");
    expect(connectorForUrl("javascript:alert(1)")).toBeUndefined();
    expect(connectorForUrl("bad")).toBeUndefined();
  });
});
