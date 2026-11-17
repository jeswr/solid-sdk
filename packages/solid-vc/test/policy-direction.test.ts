// AUTHORED-BY Codex GPT-6.1-Sol

import { parseRdf } from "@jeswr/fetch-rdf";
import { DataFactory } from "n3";
import { describe, expect, it } from "vitest";
import {
  buildAgentAuthorizationCredential,
  buildBoundAgentAuthorizationCredential,
  digestQuads,
  digestRdfContent,
  issue,
  issueAgentAuthorization,
  verifyCredential,
  verifyRelatedResources,
} from "../src/index.js";
import { serialize } from "../src/serialize.js";
import { ACL_READ, AGENT, expectDefined, ISSUER, issuerKey, keyResolver } from "./helpers.js";

const POLICY_IRI = "https://alice.example/policies/notes#agreement";
const LABEL = "https://example.org/label";
const RDF = "http://www.w3.org/1999/02/22-rdf-syntax-ns#";
const AUTH = {
  principal: ISSUER,
  agent: AGENT,
  action: ACL_READ,
  policy: POLICY_IRI,
} as const;

/** Generate Turtle through n3.Writer, with JSON-LD as the source graph. */
async function policyContent(
  contentType: string,
  language: string,
  direction?: "ltr" | "rtl",
): Promise<string> {
  const json = JSON.stringify({
    "@id": POLICY_IRI,
    [LABEL]: {
      "@value": "v",
      "@language": language,
      ...(direction === undefined ? {} : { "@direction": direction }),
    },
  });
  if (contentType === "application/ld+json") return json;
  return serialize([...(await parseRdf(json, "application/ld+json")).match()]);
}

describe("policy-content directional literals", () => {
  for (const contentType of ["text/turtle", "application/ld+json"]) {
    for (const [language, direction] of [
      ["en", "ltr"],
      ["fr", "rtl"],
    ] as const) {
      const label = `${contentType} ${language}--${direction}`;

      it(`refuses to digest ${label} through either digest API`, async () => {
        const content = await policyContent(contentType, language, direction);
        const quads = [...(await parseRdf(content, contentType)).match()];
        const literal = expectDefined(quads[0], "label quad").object;
        expect(literal).toMatchObject({
          termType: "Literal",
          value: "v",
          language,
          direction,
          datatype: { value: `${RDF}dirLangString` },
        });
        if (contentType === "text/turtle") {
          expect(content).toContain(`"v"@${language}--${direction}`);
        }
        await expect(digestQuads(quads)).rejects.toThrow(/refusing to digest.*direction/i);
        await expect(digestRdfContent(content, contentType)).rejects.toThrow(
          /refusing to digest.*direction/i,
        );
      });

      it(`refuses to build or issue a policy binding for ${label}`, async () => {
        const auth = {
          ...AUTH,
          policyContent: await policyContent(contentType, language, direction),
          policyContentType: contentType,
        };
        await expect(buildBoundAgentAuthorizationCredential(auth)).rejects.toThrow(
          /refusing to digest.*direction/i,
        );
        await expect(issueAgentAuthorization(auth, await issuerKey())).rejects.toThrow(
          /refusing to digest.*direction/i,
        );
      });

      it(`rejects presented ${label} against the old colliding digest without throwing`, async () => {
        const key = await issuerKey();
        // A retained digest from the pre-fix implementation: both language/direction
        // variants canonicalized to the same "v"^^rdf:dirLangString literal.
        const credential = await issue({
          credential: {
            ...buildAgentAuthorizationCredential(AUTH),
            relatedResource: [
              {
                id: POLICY_IRI,
                digestMultibase: "zQmX9Gexep13jFpBCDpfP5Q2cxTjyDsHaDsitNTqaWzpmLm",
              },
            ],
          },
          key,
        });
        expect(
          (await verifyCredential(credential, { resolveKey: keyResolver(key) })).verified,
        ).toBe(true);
        const presentedResources = {
          [POLICY_IRI]: {
            content: await policyContent(contentType, language, direction),
            contentType,
          },
        };
        const result = await verifyCredential(credential, {
          resolveKey: keyResolver(key),
          presentedResources,
        });
        expect(result.verified).toBe(false);
        expect(result.errors).toEqual([
          {
            code: "RELATED_RESOURCE_MISMATCH",
            message: expect.stringMatching(/refusing to digest.*direction/i),
          },
        ]);
        expect(await verifyRelatedResources(credential, presentedResources)).toEqual(result);
      });
    }

    it(`still digests and verifies ordinary language-tagged ${contentType} content`, async () => {
      const content = await policyContent(contentType, "en");
      const digest = await digestRdfContent(content, contentType);
      expect(digest).not.toBe(
        await digestRdfContent(await policyContent(contentType, "fr"), contentType),
      );
      const key = await issuerKey();
      const credential = await issueAgentAuthorization(
        { ...AUTH, policyContent: content, policyContentType: contentType },
        key,
      );
      expect(credential.relatedResource?.[0]?.digestMultibase).toBe(digest);
      expect(
        await verifyCredential(credential, {
          resolveKey: keyResolver(key),
          presentedResources: { [POLICY_IRI]: { content, contentType } },
        }),
      ).toMatchObject({ verified: true, errors: [] });
    });
  }

  it("refuses rdf:dirLangString even without a direction property", async () => {
    const content = JSON.stringify({
      "@id": POLICY_IRI,
      [LABEL]: { "@value": "v", "@type": `${RDF}dirLangString` },
    });
    const dataset = await parseRdf(content, "application/ld+json");
    const quads = [...dataset.match()];
    const literal = expectDefined(quads[0], "typed label quad").object;
    expect(literal).toMatchObject({ termType: "Literal", language: "", direction: "" });
    Object.defineProperty(literal, "direction", { value: undefined });
    await expect(digestQuads(quads)).rejects.toThrow(/refusing to digest.*dirLangString/i);
    await expect(digestRdfContent(content, "application/ld+json")).rejects.toThrow(
      /refusing to digest.*dirLangString/i,
    );
  });

  it("refuses a base direction even when the datatype does not identify it", async () => {
    const content = await policyContent("text/turtle", "en", "ltr");
    const quads = [...(await parseRdf(content, "text/turtle")).match()];
    const literal = expectDefined(quads[0], "directional label quad").object;
    Object.defineProperty(literal, "datatype", {
      value: DataFactory.namedNode(`${RDF}langString`),
    });
    expect(literal).toMatchObject({ direction: "ltr", datatype: { value: `${RDF}langString` } });
    await expect(digestQuads(quads)).rejects.toThrow(/refusing to digest.*direction/i);
  });
});
