// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Fable 5
// AUTHORED-BY Codex GPT-6.1-Sol
import { Store } from "n3";
import { describe, expect, it } from "vitest";
import { addInterpretation } from "../reliability.js";
import { buildReply } from "../reply.js";
import {
  AGENTIC_IN_REPLY_TO,
  PROV_WAS_ATTRIBUTED_TO,
  RDF_TYPE,
  SCHEMA_ACCEPT_ACTION,
  SCHEMA_DATE_SENT,
  SCHEMA_PROPOSE_ACTION,
  SCHEMA_START_TIME,
} from "../vocab.js";
import { extractAgenticReply, extractAgenticReplyStructural } from "./agentic-reply.js";
import { buildActionMetadata } from "./emit.js";
import {
  PROPOSE_TIMES_PATTERN_HASH,
  PROPOSE_TIMES_PATTERN_IRI,
  SENT_AT_PATTERN_HASH,
  SENT_AT_PATTERN_IRI,
} from "./patterns.js";

const CTX = { docIri: "https://pod.example/inbox/m.ttl" };
const RAW_URN = "urn:agentic:raw:abc123";

/** The design §5.4 worked-example block (an AcceptAction from a peer agent). */
const ACCEPT_BLOCK = JSON.stringify({
  "@context": [
    "https://www.w3.org/ns/credentials/v2",
    "https://schema.org",
    "https://w3id.org/jeswr/agentic",
  ],
  type: ["VerifiableCredential", "AgenticReply"],
  issuer: "https://jeswr.org/agent",
  credentialSubject: {
    type: "AcceptAction",
    "dct:conformsTo": {
      "@id": "https://w3id.org/jeswr/agentic/patterns/accept-time",
      protocolHash: `sha256:${"ab".repeat(32)}`,
    },
    "agentic:inReplyTo": RAW_URN,
    "schema:dateSent": "2026-07-05T09:12:00Z",
    object: [
      {
        type: "Event",
        name: "Call: Jesse / Alice",
        startTime: "2026-07-08T10:00:00Z",
        endTime: "2026-07-08T10:30:00Z",
      },
    ],
  },
  proof: { type: "DataIntegrityProof", cryptosuite: "eddsa-rdfc-2022" },
});

describe("extractAgenticReplyStructural (unverified — never auto-run)", () => {
  it("extracts the worked-example structure, ALL SelfReported, issuer NEVER asserted", () => {
    const out = extractAgenticReplyStructural([ACCEPT_BLOCK], CTX);
    expect(out.verified).toBe(false);
    expect(out.issuer).toBeUndefined();

    const type = out.interpretations.find((i) => i.predicate === RDF_TYPE);
    expect(type?.object).toEqual({ kind: "iri", value: SCHEMA_ACCEPT_ACTION });
    expect(type?.subject).toBe(`${CTX.docIri}#areply-1`);

    const dateSent = out.interpretations.find((i) => i.predicate === SCHEMA_DATE_SENT);
    expect(dateSent?.object).toMatchObject({ value: "2026-07-05T09:12:00.000Z" });

    const inReplyTo = out.interpretations.find((i) => i.predicate === AGENTIC_IN_REPLY_TO);
    expect(inReplyTo?.object).toEqual({ kind: "iri", value: RAW_URN });

    const start = out.interpretations.find((i) => i.predicate === SCHEMA_START_TIME);
    expect(start?.object).toMatchObject({ value: "2026-07-08T10:00:00.000Z" });

    // The load-bearing trust split: nothing from an UNVERIFIED block may be
    // Calibrated/Verified (classifyReliability would auto-run it).
    for (const interp of out.interpretations) {
      expect(interp.calibration).toBe("SelfReported");
    }
    expect(out.interpretations.find((i) => i.predicate === PROV_WAS_ATTRIBUTED_TO)).toBeUndefined();

    // Pattern conformance surfaces for the (hash → handler) cache.
    expect(out.patterns).toEqual([
      {
        iri: "https://w3id.org/jeswr/agentic/patterns/accept-time",
        protocolHash: `sha256:${"ab".repeat(32)}`,
      },
    ]);
  });

  it("rejects a hostile inReplyTo / malformed hash / non-http conformance", () => {
    const hostile = JSON.stringify({
      type: "AgenticReply",
      credentialSubject: {
        type: "AcceptAction",
        inReplyTo: "urn:agentic:raw:x> <https://x> <https://y> .", // IRIREF breakout
        conformsTo: [
          { "@id": "javascript:alert(1)", protocolHash: `sha256:${"ab".repeat(32)}` },
          { "@id": "https://ok.example/p", protocolHash: "sha256:NOTHEX" },
        ],
      },
    });
    const out = extractAgenticReplyStructural([hostile], CTX);
    expect(out.interpretations.find((i) => i.predicate === AGENTIC_IN_REPLY_TO)).toBeUndefined();
    expect(out.patterns).toEqual([{ iri: "https://ok.example/p" }]); // hash dropped, IRI kept
  });

  it("preserves self-reported Message envelopes without asserting an action or issuer", async () => {
    const root = JSON.parse(ACCEPT_BLOCK);
    root.credentialSubject.type = "Message";
    const blocks = [JSON.stringify(root)];
    const structural = extractAgenticReplyStructural(blocks, CTX);
    expect(structural.interpretations.find((i) => i.predicate === SCHEMA_DATE_SENT)).toMatchObject({
      calibration: "SelfReported",
    });
    expect(
      structural.interpretations.find(
        (i) => i.subject === `${CTX.docIri}#areply-1` && i.predicate === RDF_TYPE,
      ),
    ).toBeUndefined();
    expect(
      structural.interpretations.find((i) => i.predicate === PROV_WAS_ATTRIBUTED_TO),
    ).toBeUndefined();
    expect(await extractAgenticReply(blocks, CTX)).toEqual(structural);
  });

  it("ignores non-AgenticReply blocks and malformed JSON", () => {
    const out = extractAgenticReplyStructural(
      ["{broken", JSON.stringify({ "@type": "Event" }), "[]"],
      CTX,
    );
    expect(out.interpretations).toEqual([]);
    expect(out.patterns).toEqual([]);
  });
});

describe("extractAgenticReply (the injectable verifier seam)", () => {
  it.each([
    { type: ["AcceptAction", "RejectAction"] },
    { type: ["RejectAction", "AcceptAction"] },
    { "@type": ["schema:ProposeAction", "https://schema.org/AcceptAction"] },
    { type: "AcceptAction", "@type": "RejectAction" },
    { type: "AcceptAction", "@type": "AcceptAction" },
    { type: ["AcceptAction", "schema:AcceptAction"] },
    { type: ["AcceptAction", "AcceptAction"] },
    { type: ["AcceptAction", ...Array(7).fill("Other"), "RejectAction"] },
    { type: ["schema:AcceptAction", "https://schema.org/AcceptAction"] },
    { type: ["https://schema.org/AcceptAction", "schema:AcceptAction"] },
    { "@type": "AcceptAction", type: "RejectAction" },
    { type: [...Array(8).fill("Other"), "AcceptAction", "RejectAction"] },
    { type: ["Message", "AcceptAction", "RejectAction"] },
    { type: ["RejectAction", "AcceptAction", "Message"] },
    { type: "Message", "@type": "AcceptAction" },
    { type: "Other" },
    {},
  ])("rejects verified replies without exactly one unambiguous action: %j", async (types) => {
    const block = JSON.parse(ACCEPT_BLOCK);
    const { type: _type, ...subject } = block.credentialSubject;
    block.credentialSubject = { ...subject, ...types };
    const out = await extractAgenticReply([JSON.stringify(block)], CTX, {
      verify: () => ({ verified: true, issuer: "https://jeswr.org/agent" }),
    });
    expect(out).toEqual({ interpretations: [], patterns: [], verified: false });
    if (Object.keys(types).length > 0 && types.type !== "Other") {
      expect(extractAgenticReplyStructural([JSON.stringify(block)], CTX)).toEqual({
        interpretations: [],
        patterns: [],
        verified: false,
      });
    }
  });

  it.each([
    "AcceptAction",
    "schema:AcceptAction",
    "https://schema.org/AcceptAction",
  ])("accepts a single supported action spelling: %s", async (action) => {
    for (const types of [
      ["Other", action],
      [action, "Other"],
    ]) {
      const block = JSON.parse(ACCEPT_BLOCK);
      block.credentialSubject.type = types;
      const out = await extractAgenticReply([JSON.stringify(block)], CTX, {
        verify: () => ({ verified: true }),
      });
      expect(out.verified).toBe(true);
      expect(out.interpretations.find((i) => i.predicate === RDF_TYPE)?.object).toEqual({
        kind: "iri",
        value: SCHEMA_ACCEPT_ACTION,
      });
    }
  });

  it("verified block → Calibrated content + issuer asserted at Verified", async () => {
    const out = await extractAgenticReply([ACCEPT_BLOCK], CTX, {
      verify: (credential) => ({
        verified: true,
        issuer: typeof credential.issuer === "string" ? credential.issuer : undefined,
      }),
    });
    expect(out.verified).toBe(true);
    expect(out.issuer).toBe("https://jeswr.org/agent");

    const start = out.interpretations.find((i) => i.predicate === SCHEMA_START_TIME);
    expect(start?.calibration).toBe("Calibrated");
    expect(start?.confidence).toBe(1);

    const attributed = out.interpretations.find((i) => i.predicate === PROV_WAS_ATTRIBUTED_TO);
    expect(attributed?.object).toEqual({ kind: "iri", value: "https://jeswr.org/agent" });
    expect(attributed?.calibration).toBe("Verified");
  });

  it("a failed / throwing / absent verifier fails closed to unverified", async () => {
    for (const verify of [
      () => ({ verified: false }),
      () => {
        throw new Error("boom");
      },
      undefined,
    ] as const) {
      const out = await extractAgenticReply(
        [ACCEPT_BLOCK],
        CTX,
        verify === undefined ? undefined : { verify },
      );
      expect(out.verified).toBe(false);
      for (const interp of out.interpretations) {
        expect(["SelfReported"]).toContain(interp.calibration);
      }
    }
  });

  it("a verified verdict with a non-http issuer never asserts the issuer", async () => {
    const out = await extractAgenticReply([ACCEPT_BLOCK], CTX, {
      verify: () => ({ verified: true, issuer: "javascript:alert(1)" }),
    });
    expect(out.verified).toBe(true);
    expect(out.issuer).toBeUndefined();
    expect(out.interpretations.find((i) => i.predicate === PROV_WAS_ATTRIBUTED_TO)).toBeUndefined();
  });

  it.each([
    "Message",
    "schema:Message",
    "https://schema.org/Message",
  ])("verifies supported %s envelopes without asserting an action", async (type) => {
    const built = await buildActionMetadata({ sentAt: "2026-07-05T09:12:00Z" });
    const subject = built.credential.credentialSubject as Record<string, unknown>;
    subject.type = type;
    const out = await extractAgenticReply([JSON.stringify(built.credential)], CTX, {
      verify: () => ({ verified: true, issuer: "https://jeswr.org/agent" }),
    });
    expect(out.verified).toBe(true);
    expect(out.issuer).toBe("https://jeswr.org/agent");
    expect(out.interpretations.find((i) => i.predicate === SCHEMA_DATE_SENT)).toMatchObject({
      object: { value: "2026-07-05T09:12:00.000Z" },
      calibration: "Calibrated",
    });
    expect(out.patterns).toEqual([
      { iri: SENT_AT_PATTERN_IRI, protocolHash: SENT_AT_PATTERN_HASH },
    ]);
    expect(out.interpretations.find((i) => i.predicate === PROV_WAS_ATTRIBUTED_TO)).toMatchObject({
      object: { kind: "iri", value: "https://jeswr.org/agent" },
      calibration: "Verified",
    });
    expect(out.interpretations.find((i) => i.predicate === RDF_TYPE)).toBeUndefined();
  });
});

describe("round-trip: buildActionMetadata → extractAgenticReply", () => {
  it("preserves the signed Message timestamp, pattern and verified issuer", async () => {
    const built = await buildActionMetadata({
      sentAt: "2026-07-05T09:12:00Z",
      issuer: "https://jeswr.org/agent",
      sign: (credential) => ({ ...credential, proof: { type: "DataIntegrityProof" } }),
    });
    expect(built.signed).toBe(true);
    const blocks = [built.mimePart.body];
    const structural = extractAgenticReplyStructural(blocks, CTX);
    for (const verify of [
      undefined,
      () => ({ verified: false }),
      () => {
        throw new Error("boom");
      },
    ]) {
      expect(await extractAgenticReply(blocks, CTX, verify ? { verify } : undefined)).toEqual(
        structural,
      );
    }
    const out = await extractAgenticReply(blocks, CTX, {
      verify: (credential) => ({ verified: true, issuer: credential.issuer as string }),
    });
    expect(out.verified).toBe(true);
    expect(out.issuer).toBe("https://jeswr.org/agent");
    expect(out.patterns).toEqual([
      { iri: SENT_AT_PATTERN_IRI, protocolHash: SENT_AT_PATTERN_HASH },
    ]);
    expect(out.interpretations.find((i) => i.predicate === SCHEMA_DATE_SENT)).toMatchObject({
      object: { value: "2026-07-05T09:12:00.000Z" },
      calibration: "Calibrated",
    });
    expect(out.interpretations.find((i) => i.predicate === PROV_WAS_ATTRIBUTED_TO)).toMatchObject({
      object: { kind: "iri", value: "https://jeswr.org/agent" },
      calibration: "Verified",
    });
    expect(out.interpretations.find((i) => i.predicate === RDF_TYPE)).toBeUndefined();
  });
});

describe("round-trip: buildReply → extractAgenticReply (the protocol closes the loop)", () => {
  it("our own carrier parses back deterministically, patterns + envelope intact", async () => {
    const built = await buildReply({
      inReplyTo: RAW_URN,
      offeredTimes: [
        { name: "Call", startTime: "2026-07-07T14:00:00Z", endTime: "2026-07-07T14:30:00Z" },
        { name: "Call", startTime: "2026-07-08T10:00:00Z", endTime: "2026-07-08T10:30:00Z" },
      ],
      dateSent: "2026-07-05T09:12:00Z",
      sender: "https://jeswr.org/agent",
      issuer: "https://jeswr.org/agent",
    });
    const out = await extractAgenticReply([built.mimePart.body], CTX);

    // Action type + both offered events extracted.
    const type = out.interpretations.find((i) => i.predicate === RDF_TYPE);
    expect(type?.object).toEqual({ kind: "iri", value: SCHEMA_PROPOSE_ACTION });
    const starts = out.interpretations.filter((i) => i.predicate === SCHEMA_START_TIME);
    expect(starts.map((s) => (s.object.kind === "literal" ? s.object.value : ""))).toEqual([
      "2026-07-07T14:00:00.000Z",
      "2026-07-08T10:00:00.000Z",
    ]);

    // The sent-at envelope + both hash-pinned pattern conformances round-trip.
    const dateSent = out.interpretations.find((i) => i.predicate === SCHEMA_DATE_SENT);
    expect(dateSent?.object).toMatchObject({ value: "2026-07-05T09:12:00.000Z" });
    expect(out.patterns).toEqual([
      { iri: SENT_AT_PATTERN_IRI, protocolHash: SENT_AT_PATTERN_HASH },
      { iri: PROPOSE_TIMES_PATTERN_IRI, protocolHash: PROPOSE_TIMES_PATTERN_HASH },
    ]);

    const inReplyTo = out.interpretations.find((i) => i.predicate === AGENTIC_IN_REPLY_TO);
    expect(inReplyTo?.object).toEqual({ kind: "iri", value: RAW_URN });
  });
});

describe("lowering: the urn inReplyTo object survives addInterpretation", () => {
  it("writes the reply-linkage quad (urn object IRIs accepted, fail-closed elsewhere)", () => {
    const out = extractAgenticReplyStructural([ACCEPT_BLOCK], CTX);
    const inReplyTo = out.interpretations.find((i) => i.predicate === AGENTIC_IN_REPLY_TO);
    const store = new Store();
    const iri = addInterpretation(store, inReplyTo as NonNullable<typeof inReplyTo>, 0, {
      docIri: CTX.docIri,
      rawMessageIri: RAW_URN,
    });
    expect(iri).toBe(`${CTX.docIri}#interp-0`);
    const objects = store.getQuads(
      null,
      "https://w3id.org/jeswr/agentic#assertsObjectIri",
      null,
      null,
    );
    expect(objects).toHaveLength(1);
    expect(objects[0]?.object.value).toBe(RAW_URN);
  });
});
