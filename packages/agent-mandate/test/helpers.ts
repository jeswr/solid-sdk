// AUTHORED-BY Codex GPT-6.1-Sol
import {
  createWebIdKeyResolver,
  generateKeyPairForSuite,
  type KeyPair,
  publishVerificationMethod,
} from "@jeswr/solid-vc";
import { defaultMandate } from "../src/mandate.js";
import { AGENT, type Intent, type Mandate } from "../src/types.js";
export const OWNER = "https://owner.example/profile#me";
export const ACTOR = "https://agent.example/#me";
export const ID = "https://pod.example/agent/mandates/default";
export const STATUS = "https://pod.example/agent/mandates/status.ttl";
export const NOW = new Date("2026-10-26T12:00:00Z");
export const HASH = `sha256:${"a".repeat(64)}`;
export const clock = () => NOW;
export const mandate = (): Mandate =>
  defaultMandate({
    id: ID,
    ownerWebId: OWNER,
    agentWebId: ACTOR,
    recipientHashes: [HASH],
    now: NOW,
  });
export const intent = (extra: Partial<Intent> = {}): Intent => ({
  agent: ACTOR,
  action: `${AGENT}SendMessage`,
  target: "https://pod.example/proposals/1",
  at: NOW.toISOString(),
  attributes: { [`${AGENT}binding`]: "gmail", [`${AGENT}recipientSet`]: HASH },
  ...extra,
});
export const edKey = () => generateKeyPairForSuite(`${OWNER}/ed`);
export async function approvalKey(): Promise<KeyPair> {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  return { ...keys, verificationMethod: `${OWNER}/approval` };
}
export async function profileResolver(key: KeyPair) {
  const profile = await publishVerificationMethod({
    controller: OWNER,
    verificationMethod: key.verificationMethod,
    key,
  });
  const fetchFixture: typeof fetch = async () =>
    new Response(profile.turtle, { headers: { "content-type": "text/turtle" } });
  return createWebIdKeyResolver({ fetch: fetchFixture });
}
