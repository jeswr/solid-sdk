// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { issueApproval } from "@jeswr/agent-mandate/approval";
import { digestOf, type PodRecord, recordToTurtle } from "@jeswr/agent-model";
import { exampleRecords } from "@jeswr/agent-model/testing";
import { serialize } from "@jeswr/rdf-serialize";
import { type KeyPair, publishVerificationMethod } from "@jeswr/solid-vc";
import { Store } from "n3";
import { type AuditEntry, auditHeadToTurtle, auditToTurtle, sealAudit } from "./audit";
import { demoAccountHash, demoMandateFiles } from "./demo-mandate";
import { AGENT, metadataNode, PROV, RDF } from "./paths";

/**
 * Structurally the demo pod's DemoSeedFile. Declared here because the native build stages the
 * app without src/lib/demo-pod, and this module must still type-check there.
 */
export interface DemoSeedFile {
  readonly path: string;
  readonly body: Uint8Array | string;
  readonly contentType: string;
  readonly modified?: number;
}

const ROOT = "https://alice.demo.pod/";
const BASE = `${ROOT}agent/`;
const OWNER = `${ROOT}profile/card#me`;
// Publicly known P-256 test scalar 1. ONLY for the synthetic alice.demo.pod seed;
// never persisted in the device keystore or used by the production signing path.
const DEMO_PUBLIC_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "axfR8uEsQkf4vOblY6RA8ncDfYEt6zOg9KE5RdiYwpY",
  y: "T-NC4v4af5uO5-tKfA-eFivOM1drMV7Oy7ZAaDe_UfU",
};
export async function demoApprovalKey(): Promise<KeyPair> {
  const algorithm = { name: "ECDSA", namedCurve: "P-256" };
  return {
    verificationMethod: `${ROOT}profile/card#agent-demo-test-key`,
    publicKey: await crypto.subtle.importKey("jwk", DEMO_PUBLIC_JWK, algorithm, true, ["verify"]),
    privateKey: await crypto.subtle.importKey(
      "jwk",
      { ...DEMO_PUBLIC_JWK, d: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAE" },
      algorithm,
      false,
      ["sign"],
    ),
  };
}
export async function demoApprovalVerificationMethod() {
  return publishVerificationMethod({ controller: OWNER, key: await demoApprovalKey() });
}
/** Build synthetic records, with approvals issued by the real signing library. */
export async function buildAgentSeed(now: number): Promise<DemoSeedFile[]> {
  const at = (offset: number) => new Date(now + offset).toISOString();
  const id = (path: string) => `${BASE}${path}`;
  const authority = await demoMandateFiles(now);
  const records: PodRecord[] = [];
  const account = exampleRecords.account;
  const configs = [
    {
      slug: "gmail",
      provider: "gmail",
      label: "Personal Gmail",
      channel: "email",
      state: "connected",
      read: true,
    },
    {
      slug: "graph-mail",
      provider: "graph-mail",
      label: "Work mail",
      channel: "email",
      state: "setup-required",
      read: true,
    },
    {
      slug: "matrix",
      provider: "matrix",
      label: "Matrix",
      channel: "matrix",
      state: "none",
      read: false,
    },
    {
      slug: "conflict",
      provider: "gmail",
      label: "Imported account",
      channel: "email",
      state: "error",
      read: false,
    },
  ] as const;
  for (const config of configs)
    records.push({
      ...account,
      id: id(`accounts/${config.slug}.ttl`),
      provider: config.provider,
      label: config.label,
      channel: config.channel,
      bindingState: config.state,
      channelHandleHash: demoAccountHash(config.slug),
      restrictions: { read: config.read, triage: config.read, draft: false, send: false },
      inventory: {
        channelHandles:
          config.slug === "conflict"
            ? ["salted-demo-one", "salted-demo-two"]
            : [demoAccountHash(config.slug)],
        credentialRefs: [],
        setupStatus: config.state,
        observedAt: at(-60_000),
        lastTested: at(-60_000),
        evidence: [],
        identityConflicts:
          config.slug === "conflict"
            ? [{ kind: "identity-mismatch", handleHashes: ["salted-demo-one", "salted-demo-two"] }]
            : [],
      },
    });
  for (const binding of ["gmail", "graph-mail"])
    records.push({
      ...exampleRecords["channel-capability"],
      id: id(`descriptors/${binding}.ttl`),
      binding,
      credentialState: binding === "gmail" ? "connected" : "setup-required",
      lastIngest: at(-45_000),
    });
  const subjects = [
    "Project catch-up",
    "Calendar invitation",
    "Weekly notes",
    "Welcome to the team",
  ];
  for (let i = 0; i < 4; i++) {
    const binding = i === 3 ? "graph-mail" : "gmail";
    records.push({
      ...exampleRecords["inbound-message"],
      id: id(`inbox/${binding}/${binding}/message-${i}.ttl`),
      binding,
      channelHandleHash: `salted-demo-${binding}`,
      subject: subjects[i] as string,
      text:
        i === 1
          ? "Let's meet tomorrow at 14:00. <b>This is plain text.</b>"
          : `Demo message: ${subjects[i]}.`,
      receivedAt: at(-(i + 1) * 60_000),
      structuredPart:
        i === 1
          ? [
              {
                type: "text/calendar",
                name: "Project catch-up",
                start: at(86_400_000),
                end: at(90_000_000),
                location: "Meeting room",
              },
              {
                type: "text/html",
                value:
                  '<b>HTML alternative</b><img src="https://example.invalid/pixel" alt="Tracking pixel">',
              },
            ]
          : [],
    });
  }
  for (const [conversation, texts] of [
    [
      "welcome",
      [
        "Plan my week",
        "I can help you prepare your week.",
        "Draft a reply to the catch-up",
        "I've prepared a reply for your approval.",
      ],
    ],
    [
      "preferences",
      [
        "Remember my meeting preference",
        "I'll ask before remembering that you prefer afternoon meetings.",
      ],
    ],
  ] as const) {
    texts.forEach((text, index) => {
      records.push({
        ...exampleRecords["conversation-turn"],
        id: id(`conversations/${conversation}/${index}.ttl`),
        conversation: id(`conversations/${conversation}/`),
        attributedTo: index % 2 === 0 ? OWNER : id("#agent"),
        role: index % 2 === 0 ? "owner" : "agent",
        text,
        createdAt: at(-600_000 + index * 60_000),
        refersToProposal: index === 3 ? [id("proposals/send-reply.ttl")] : [],
      });
    });
  }
  for (const [index, slug] of ["send-reply", "remember-preference", "prohibited-send"].entries()) {
    const intent = {
      ...exampleRecords["action-proposal"].intent,
      conversation: id("conversations/welcome/"),
      binding: "gmail",
      action: `${AGENT}${index === 1 ? "Remember" : "SendMessage"}`,
      recipientHash: index === 2 ? `sha256:${"a".repeat(64)}` : demoAccountHash("gmail"),
      parameters: {
        summary: subjects[index] as string,
        approvalRule: "Ask before sending to another person or saving a preference",
        prohibited: index === 2,
      },
      termsDigest: "",
    };
    intent.termsDigest = digestOf({ ...intent, termsDigest: "" });
    records.push({
      ...exampleRecords["action-proposal"],
      id: id(`proposals/${slug}.ttl`),
      intent,
      renderedPreview:
        index === 0
          ? "Subject: Re: Project catch-up\nTo: My own account\n\nThanks for the invitation. Tomorrow at 14:00 works for me.\n\n— Alice"
          : index === 1
            ? "Remember: I prefer afternoon meetings."
            : "Send a message to a recipient outside the permitted accounts.",
      createdAt: at(-120_000 + index * 1000),
      validUntil: at(86_400_000),
      state: "proposed",
    });
  }
  const mandate = {
    ...exampleRecords["mandate-reference"],
    id: id("mandates/demo.ttl"),
    credential: id("mandates/demo-credential.trig"),
    credentialStatus: id("mandates/status.ttl"),
    digest: authority.digest,
    validFrom: at(-86_400_000),
    validUntil: at(30 * 86_400_000),
  };
  records.push(mandate, { ...mandate, id: id("mandates/current.ttl") });
  records.push({
    ...exampleRecords.transmission,
    id: id("outbox/sent-demo.ttl"),
    proposal: id("proposals/previous-reply.ttl"),
    underMandate: mandate.credential,
    underApproval: id("approvals/previous-reply.trig"),
    status: "sent",
    startedAt: at(-3_600_000),
    endedAt: at(-3_599_000),
  });
  records.push({
    ...exampleRecords["control-statement"],
    id: id("control/resume.ttl"),
    kind: "Resume",
    restrictions: undefined,
    attributedTo: OWNER,
    createdAt: at(-3_800_000),
    expires: at(86_400_000),
  });
  const audit: AuditEntry[] = [];
  let prev = "sha-256:genesis";
  for (let seq = 1; seq <= 12; seq++) {
    const kinds = [
      "ingest",
      "model-call",
      "proposal",
      "decision",
      "approval-seen",
      "control",
      "mandate-change",
      "model-call",
      "ingest",
      "ingest",
      "transmission",
      "receipt",
    ] as const;
    const kind = kinds[seq - 1] as (typeof kinds)[number];
    const connected = [3, 4, 5, 11, 12].includes(seq);
    const entry = sealAudit(seq, at(-3_600_000 + seq * 60_000), prev, {
      type: kind,
      id:
        seq === 3
          ? id("proposals/previous-reply.ttl")
          : seq === 11
            ? id("outbox/sent-demo.ttl")
            : `urn:demo:activity:${seq}`,
      agent: id("#agent"),
      owner: OWNER,
      accountId: "gmail",
      ...(connected
        ? {
            proposal: id("proposals/previous-reply.ttl"),
            mandate: mandate.credential,
            decisionRecord: "urn:demo:activity:4",
            approval: id("approvals/previous-reply.trig"),
            transmission: id("outbox/sent-demo.ttl"),
            receipt: "urn:demo:activity:12",
          }
        : {}),
      ...(seq === 11
        ? { status: "sent" as const, recipientHashes: [`sha256:${"a".repeat(64)}`] }
        : {}),
    });
    audit.push(entry);
    prev = entry.hash;
  }
  const files: DemoSeedFile[] = await Promise.all(
    records.map(async (record) => ({
      path: record.id.slice(ROOT.length),
      body: await recordToTurtle(record),
      contentType: "text/turtle",
      modified: now,
    })),
  );
  files.push({
    path: "agent/approvals/previous-reply.trig",
    body: await issueApproval(
      {
        id: id("approvals/previous-reply.trig"),
        approves: id("proposals/previous-reply.ttl"),
        termsDigest: exampleRecords.approval.termsDigest,
        decision: "approve",
        expires: at(86_400_000),
      },
      await demoApprovalKey(),
      new Date(at(-3_700_000)),
    ),
    contentType: "application/trig",
    modified: now,
  });
  for (const entry of audit)
    files.push({
      path: `agent/audit/${entry.seq}.ttl`,
      body: await auditToTurtle(id(`audit/${entry.seq}.ttl`), entry),
      contentType: "text/turtle",
      modified: now,
    });
  files.push({
    path: "agent/audit/chain.ttl",
    body: await auditHeadToTurtle(id("audit/chain.ttl"), audit.at(-1) as AuditEntry),
    contentType: "text/turtle",
    modified: now,
  });
  const metadata = async (
    path: string,
    configure: (node: ReturnType<typeof metadataNode>) => void,
  ) => {
    const store = new Store();
    const node = metadataNode(store, id(path));
    configure(node);
    files.push({
      path: `agent/${path}`,
      body: await serialize([...store], { format: "text/turtle" }),
      contentType: "text/turtle",
      modified: now,
    });
  };
  files.push(...authority.files);
  await metadata("descriptors/agent.ttl", (node) => {
    node.setIri(`${RDF}type`, `${AGENT}ImplementationDescription`);
    node.setIri(`${AGENT}describes`, id("card#agent"));
  });
  await metadata("control/heartbeat.ttl", (node) => {
    node.setIri(`${RDF}type`, `${AGENT}Heartbeat`);
    node.setText(`${PROV}generatedAtTime`, at(-30_000));
  });
  await metadata("inbox/gmail/gmail/message-1.triage.ttl", (node) => {
    node.setIri(`${RDF}type`, `${AGENT}TriageAssessment`);
    node.setIri(`${PROV}wasDerivedFrom`, id("inbox/gmail/gmail/message-1.ttl"));
    node.setText(`${AGENT}primaryClass`, "meeting");
    node.setText(`${AGENT}urgency`, "normal");
    node.setText(`${AGENT}confidence`, "0.99");
  });
  return files;
}
