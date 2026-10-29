// AUTHORED-BY Codex GPT-6.1-Sol
// TEST FIXTURE ONLY. Adapted from personal-agent src/pilot/mandates.ts schedulingMandate.
// Generates fresh synthetic keys; writes only the public JWK and signed fixture, never private material.
// biome-ignore lint/style/useNodejsImportProtocol: the agent import guard requires bare module names
import { writeFileSync } from "fs";
import { CompactSign, calculateJwkThumbprint, exportJWK, generateKeyPair } from "jose";

const owner = "https://owner.example/profile#me";
const actor = "https://agent.example/#me";
const purpose = "https://w3id.org/dpv#CommunicationManagement";
const target = "https://w3id.org/jeswr/awp#op/schedule-meeting";
const payment = "https://w3id.org/jeswr/awp#op/payment";
const payload = {
  type: "OwnerMandate",
  id: "urn:example:pilot-mandate",
  version: 1,
  issuer: owner,
  subject: actor,
  validFrom: "2026-10-19T00:00:00.000Z",
  validUntil: "2026-11-19T00:00:00.000Z",
  autonomous: {
    id: "urn:example:pilot-autonomous",
    type: "Set",
    assigner: owner,
    assignee: actor,
    conflict: "prohibit",
    permissions: [
      {
        id: "urn:example:schedule-known",
        type: "permission",
        action: "use",
        target,
        constraints: [
          { leftOperand: "purpose", operator: "isAnyOf", rightOperand: [purpose] },
          {
            leftOperand: "recipient",
            operator: "isAnyOf",
            rightOperand: ["https://peer.example/#me"],
          },
        ],
      },
    ],
    prohibitions: [
      { id: "urn:example:no-payment", type: "prohibition", action: "compensate", target: payment },
    ],
  },
  withApproval: {
    id: "urn:example:pilot-approval",
    type: "Set",
    assigner: owner,
    assignee: actor,
    conflict: "prohibit",
    permissions: [
      {
        id: "urn:example:schedule-other",
        type: "permission",
        action: "use",
        target,
        constraints: [{ leftOperand: "purpose", operator: "isAnyOf", rightOperand: [purpose] }],
      },
    ],
  },
  note: "Synthetic pilot mandate. Scheduling only; no payments; no other operations.",
};
const key = await generateKeyPair("EdDSA", { extractable: true });
const publicJwk = await exportJWK(key.publicKey);
const kid = await calculateJwkThumbprint(publicJwk);
const jws = await new CompactSign(new TextEncoder().encode(JSON.stringify(payload)))
  .setProtectedHeader({ alg: "EdDSA", kid, typ: "awp-mandate+jws" })
  .sign(key.privateKey);
writeFileSync(
  new URL("../test/fixtures/legacy.json", import.meta.url),
  `${JSON.stringify({ authoredBy: "AUTHORED-BY Codex GPT-6.1-Sol", fixture: "TEST ONLY: synthetic pilot schedulingMandate", publicJwk, kid, jws, payload }, null, 2)}\n`,
);
