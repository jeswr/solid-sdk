// AUTHORED-BY Codex GPT-6.1-Sol
import { issueApproval } from "@jeswr/agent-mandate/approval";
import { defaultMandate, issueMandate, mandateToTurtle } from "@jeswr/agent-mandate/issue";
import { AGENT } from "@jeswr/agent-mandate/verify";
import type { Approval } from "@jeswr/agent-model";
import { parseRdf } from "@jeswr/fetch-rdf";
import { serialize } from "@jeswr/rdf-serialize";
import {
  buildBitstringStatusListCredential,
  credentialToRdf,
  DataIntegritySuite,
  digestQuads,
  generateKeyPairForSuite,
  issue,
  type KeyPair,
  publishVerificationMethod,
  statusListCredentialToTurtle,
} from "@jeswr/solid-vc";
import type { DemoSeedFile } from "../../../lib/demo-pod/pod";

const ROOT = "https://alice.demo.pod/";
const OWNER = `${ROOT}profile/card#me`;
let key: Promise<KeyPair> | undefined;
const demoKey = () =>
  (key ??= generateKeyPairForSuite(`${ROOT}profile/card#demo-agent-permissions`, "P-256"));
export const demoAccountHash = (slug: string) =>
  `sha256:${({ gmail: "1", "graph-mail": "2", matrix: "3", conflict: "4" } as Record<string, string>)[slug]?.repeat(64)}`;
/** Public synthetic verification material only; the ephemeral fixture key never leaves this module. */
export async function withDemoAgentKey(profile: string) {
  const publication = await publishVerificationMethod({
    controller: OWNER,
    verificationMethod: (await demoKey()).verificationMethod,
    key: (await demoKey()).publicKey,
  });
  return serialize([...(await parseRdf(profile, "text/turtle")), ...publication.quads]);
}
export async function demoMandateFiles(
  now: number,
): Promise<{ files: DemoSeedFile[]; digest: string }> {
  const id = `${ROOT}agent/mandates/demo-credential.trig`;
  const list = `${ROOT}agent/mandates/status.ttl`;
  const m = defaultMandate({
    id,
    ownerWebId: OWNER,
    agentWebId: `${ROOT}agent/card#agent`,
    recipientHashes: [demoAccountHash("gmail")],
    now: new Date(now - 86400000),
  });
  const vc = await issueMandate(
    {
      ...m,
      prohibitions: [
        ...m.prohibitions,
        {
          type: "prohibition",
          action: `${AGENT}SendMessage`,
          constraints: [
            {
              leftOperand: `${AGENT}recipientSet`,
              operator: "isNoneOf",
              rightOperand: [demoAccountHash("gmail")],
            },
          ],
        },
      ],
    },
    await demoKey(),
    { statusListCredential: list, statusListIndex: "0" },
    { cryptosuite: "ecdsa-rdfc-2019" },
  );
  const status = await issue({
    credential: await buildBitstringStatusListCredential({
      id: list,
      issuer: OWNER,
      statusPurpose: "revocation",
      validFrom: new Date(now - 86400000).toISOString(),
      validUntil: new Date(now + 366 * 86400000).toISOString(),
    }),
    key: await demoKey(),
    suite: new DataIntegritySuite("ecdsa-rdfc-2019"),
    options: { created: new Date(now - 86400000) },
  });
  return {
    digest: await digestQuads(credentialToRdf(vc)),
    files: [
      {
        path: "agent/mandates/demo-credential.trig",
        body: await mandateToTurtle(vc),
        contentType: "application/trig",
        modified: now,
      },
      {
        path: "agent/mandates/status.ttl",
        body: await statusListCredentialToTurtle(status),
        contentType: "application/trig",
        modified: now,
      },
    ],
  };
}

export async function demoApprovalDocument(record: Approval): Promise<string> {
  return issueApproval(
    {
      id: record.id,
      approves: record.approves,
      termsDigest: record.termsDigest,
      expires: record.expires,
      decision: record.decision,
    },
    await demoKey(),
    new Date(record.createdAt),
  );
}
