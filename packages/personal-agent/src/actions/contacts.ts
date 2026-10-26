/**
 * contact.lookup — what do the owner's agent's records say about reaching a contact?
 *
 * Read-only, over the agent's own files, each validated before use (an unreadable or malformed
 * file is reported as unavailable — never thrown, never guessed around):
 *  - pinned agent keys (trust store, loaded with its thumbprint checks) — RECORDED trust anchors:
 *    a message claiming the identity is accepted only if its signature verifies against them;
 *    this lookup verifies no message;
 *  - pinned A2A endpoints — a transport only: an endpoint without pinned keys is not an identity;
 *  - addresses in the owner mandate — the mandate's signature is verified now against the pinned
 *    owner key and its validity window checked; an unverified, expired or not-yet-valid mandate
 *    lists nothing usable. A listed address says the owner may write to it, not who controls it;
 *  - remembered scheduling endpoints (associations): only an owner-confirmed, current one is
 *    usable; candidates, disputes, changes and expiry are reported as uncertainty or conflict.
 * No URL is fetched and nothing is inferred from an address.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { readA2aPeers } from "../pilot/bindings/a2a.js";
import { DEFAULT_LIMITS } from "../pilot/core/limits.js";
import { AssociationStore } from "../pilot/domains/conventional/associations.js";
import { loadMandate } from "../pilot/mechanisms/mandate.js";
import { TrustStore } from "../pilot/mechanisms/trust.js";
import type { ActionsEnv } from "./env.js";
import type { ActionDefinition } from "./types.js";

const input = z.strictObject({
  agent: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  /** An email address, or an agent/party IRI (https: or urn:). */
  contact: z
    .string()
    .max(300)
    .regex(
      /^([^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+|(https:\/\/|urn:)[^\s<>"]+)$/,
      "an email address or an https:/urn: identifier",
    ),
});

const channel = z.strictObject({
  kind: z.enum(["agent-protocol", "remembered-scheduling-endpoint", "owner-listed-address"]),
  status: z.string(),
  /** Whether a next step may be based on it (the runtime still verifies at that step). */
  usable: z.boolean(),
  detail: z.string(),
});
const result = z.strictObject({
  contact: z.string(),
  /**
   * recorded: an operator-pinned key or an owner-confirmed current endpoint exists (records, not
   * a verification of the contact); uncertain: only weaker records; conflict: records disagree;
   * unknown: nothing recorded; unavailable: a record could not be read.
   */
  certainty: z.enum(["recorded", "uncertain", "conflict", "unknown", "unavailable"]),
  channels: z.array(channel),
  identity: z.string(),
  /** What this lookup checked itself, and what it did not. */
  verification: z.string(),
  plan: z
    .strictObject({
      kind: z.literal("conventional-booking"),
      serviceId: z.string(),
      configured: z.boolean(),
      steps: z.array(z.string()),
    })
    .optional(),
});
type Channel = z.infer<typeof channel>;

const MAX_FILE = 1024 * 1024;
/** Read + JSON-parse one of the agent's files; undefined when absent, "unreadable" otherwise. */
function readJson(path: string): unknown | undefined | typeof UNREADABLE {
  if (!existsSync(path)) return undefined;
  try {
    if (statSync(path).size > MAX_FILE) return UNREADABLE;
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return UNREADABLE;
  }
}
const UNREADABLE = Symbol("unreadable");

const identitySchema = z.looseObject({ actor: z.string().min(3).max(512) });
const associationsSchema = z
  .array(
    z.looseObject({
      id: z.string().max(200),
      contact: z.string().max(300),
      serviceId: z.string().max(200),
      status: z.enum([
        "candidate",
        "accepted",
        "rejected",
        "disputed",
        "superseded",
        "expired",
        "changed",
      ]),
      source: z.looseObject({ forwarded: z.boolean() }),
      conflictsWith: z.string().max(200).optional(),
      validUntil: z.string().max(64).optional(),
    }),
  )
  .max(10_000);
const servicesSchema = z.record(z.string().max(200), z.string().max(2000));

async function loadTrust(dir: string): Promise<TrustStore | undefined | "unreadable"> {
  const raw = readJson(join(dir, "trust.json"));
  if (raw === undefined) return undefined;
  if (raw === UNREADABLE) return "unreadable";
  try {
    return await TrustStore.load(raw);
  } catch {
    return "unreadable";
  }
}

/** Recipients named by `recipient` constraints anywhere in the mandate's two policies. */
function mandateRecipients(policies: unknown[]): string[] {
  const out: string[] = [];
  for (const p of policies) {
    const perms = (p as { permissions?: unknown })?.permissions;
    if (!Array.isArray(perms)) continue;
    for (const r of perms) {
      const cs = (r as { constraints?: unknown })?.constraints;
      if (!Array.isArray(cs)) continue;
      for (const c of cs as { leftOperand?: unknown; rightOperand?: unknown }[])
        if (c?.leftOperand === "recipient")
          for (const v of Array.isArray(c.rightOperand) ? c.rightOperand : [c.rightOperand])
            if (typeof v === "string") out.push(v.toLowerCase());
    }
  }
  return out;
}

export const contactLookupAction: ActionDefinition<
  z.infer<typeof input>,
  z.infer<typeof result>,
  ActionsEnv
> = {
  id: "contact.lookup",
  version: "2",
  title: "Look up a contact's channels",
  description:
    "What the agent's records say about reaching a contact: operator-pinned agent keys, pinned A2A endpoints (transport only), addresses in the owner's mandate (signature verified now against the pinned owner key, validity window checked), and remembered scheduling endpoints with their confirmation state. Distinguishes recorded from verified; reports uncertainty, conflicts and unreadable records; never infers identity from an address or an endpoint and fetches nothing.",
  effect: "read",
  capabilities: ["agent.records.read"],
  limitations: [
    "Only a managed agent's records are read.",
    "Pinned keys are recorded trust anchors; this lookup verifies no message from the contact.",
    "An A2A endpoint without pinned keys, or an address, never establishes an identity.",
    "An unverified, expired or not-yet-valid mandate makes its listed addresses unusable.",
    "A remembered endpoint yields a plan only when the owner confirmed it and it is current; booking itself stays a separate, synthetic-only CLI step.",
  ],
  input,
  result,
  example: () => ({ agent: "demo-owner", contact: "https://agents.peer.example/personal#agent" }),
  permissions(ctx, i) {
    const ok = ctx.env.settings.managedAgents.includes(i.agent);
    return [
      {
        subject: i.agent,
        capability: "agent.records.read",
        allowed: ok,
        why: ok ? "managed by this dashboard" : "not an agent this dashboard manages",
      },
    ];
  },
  async prepare(ctx, i) {
    const dir = join(ctx.env.agentsDir, i.agent);
    const identityRaw = readJson(join(dir, "identity.json"));
    if (identityRaw === undefined)
      return { status: "needs-setup", reasons: ["the agent was not found"] };
    const identity = identitySchema.safeParse(identityRaw === UNREADABLE ? null : identityRaw);
    const isAddress = i.contact.includes("@") && !/^(https:|urn:)/.test(i.contact);
    const channels: Channel[] = [];
    const unavailable: string[] = [];
    let plan: z.infer<typeof result>["plan"];
    let verification: string;
    const trust = await loadTrust(dir);
    if (trust === "unreadable") unavailable.push("the trust store is unreadable or invalid");
    if (!identity.success) unavailable.push("the agent's identity record is unreadable");

    if (!isAddress) {
      verification =
        "Checked now: the trust store's pinned-key records (thumbprints) and the A2A peer file's shape. Not checked: any message or endpoint of the contact.";
      const keys =
        trust instanceof TrustStore ? trust.data.keys.filter((k) => k.subject === i.contact) : [];
      if (keys.length > 0)
        channels.push({
          kind: "agent-protocol",
          status: "keys-pinned",
          usable: true,
          detail: `Operator-pinned ${[...new Set(keys.map((k) => k.role))].join(" and ")} key(s) are recorded. A message claiming this identity is accepted only if its signature verifies against them.`,
        });
      let peers: { actor: string }[] = [];
      try {
        peers = readA2aPeers(dir);
      } catch {
        unavailable.push("the A2A peer file is unreadable or invalid");
      }
      if (peers.some((p) => p.actor === i.contact)) {
        const actorKey = keys.some((k) => k.role === "actor");
        channels.push({
          kind: "agent-protocol",
          status: actorKey ? "a2a-endpoint-pinned" : "endpoint-without-keys",
          usable: actorKey,
          detail: actorKey
            ? "A loopback A2A endpoint is pinned for this actor (details withheld). It is a transport only; identity comes from the pinned keys."
            : "An A2A endpoint is recorded but no actor key is pinned: an endpoint alone is not an identity.",
        });
      }
    } else {
      const address = i.contact.toLowerCase();
      const at = ctx.now().toISOString();
      // The mandate: verified against the pinned owner key now; only a current one counts.
      const jwsPath = join(dir, "mandate.jws");
      let mandateNote = "no mandate is stored";
      if (existsSync(jwsPath)) {
        let listed = false;
        let status = "listed-in-unverified-mandate";
        let why = "";
        try {
          const jws = readFileSync(jwsPath, "utf8").trim();
          const payload = JSON.parse(
            Buffer.from(jws.split(".")[1] ?? "", "base64url").toString("utf8"),
          ) as { autonomous?: unknown; withApproval?: unknown };
          listed = mandateRecipients([payload?.autonomous, payload?.withApproval]).includes(
            `mailto:${address}`,
          );
          if (!(trust instanceof TrustStore) || !identity.success)
            why = "the trust store or identity needed to verify it is unavailable";
          else {
            const v = await loadMandate(jws, {
              trust,
              actor: identity.data.actor,
              limits: DEFAULT_LIMITS,
              at,
            });
            if (!v.ok) why = v.reason;
            else {
              const m = v.loaded.mandate;
              const now = Date.parse(at);
              if (Date.parse(m.validFrom) > now) {
                status = "listed-in-not-yet-valid-mandate";
                why = `valid from ${m.validFrom}`;
              } else if (Date.parse(m.validUntil) <= now) {
                status = "listed-in-expired-mandate";
                why = `expired ${m.validUntil}`;
              } else {
                status = "listed-in-verified-mandate";
                why = `signature verified against the pinned owner key; valid until ${m.validUntil}`;
                listed = mandateRecipients([m.autonomous, m.withApproval]).includes(
                  `mailto:${address}`,
                );
              }
            }
          }
          mandateNote = `mandate: ${why}`;
        } catch {
          unavailable.push("the stored mandate is unreadable");
          mandateNote = "the stored mandate is unreadable";
        }
        if (listed) {
          const usable = status === "listed-in-verified-mandate";
          channels.push({
            kind: "owner-listed-address",
            status,
            usable,
            detail: usable
              ? `The owner's mandate lists this address as a recipient (${why}). That says the owner may write to it — the runtime's policy still decides each step — not who controls it.`
              : `The stored mandate lists this address, but the mandate is not usable now (${why}).`,
          });
        }
      }
      verification = `Checked now: ${mandateNote}; the shapes of the association and service files. Not checked: who controls the address, or any endpoint.`;
      const assocPath = join(dir, "associations.json");
      const assocRaw = readJson(assocPath);
      const assoc =
        assocRaw === undefined
          ? { success: true as const, data: [] }
          : associationsSchema.safeParse(assocRaw === UNREADABLE ? null : assocRaw);
      if (!assoc.success) unavailable.push("the remembered-endpoint records are unreadable");
      else if (assoc.data.length > 0) {
        const store = AssociationStore.snapshot(assocPath);
        const usable = store.usable(address, ctx.schedulingNow().toISOString());
        for (const a of assoc.data.filter((x) => x.contact === address)) {
          const isUsable =
            "association" in usable && !("blocked" in usable) && usable.association.id === a.id;
          channels.push({
            kind: "remembered-scheduling-endpoint",
            status: a.status,
            usable: isUsable,
            detail: `${a.serviceId} (${a.source.forwarded ? "seen in a forwarded message" : "seen from the contact"}, ${a.status}${isUsable ? ", confirmed by the owner and current" : ""})${a.conflictsWith ? "; conflicts with another remembered endpoint" : ""}`,
          });
        }
        if ("association" in usable && !("blocked" in usable)) {
          const services = servicesSchema.safeParse(readJson(join(dir, "services.json")) ?? {});
          if (!services.success) unavailable.push("the service configuration is unreadable");
          const configured =
            services.success && Object.hasOwn(services.data, usable.association.serviceId);
          plan = {
            kind: "conventional-booking",
            serviceId: usable.association.serviceId,
            configured,
            steps: [
              ...(usable.needsRecheck
                ? ["the service terms are re-checked first (the owner re-confirms if they changed)"]
                : []),
              configured
                ? `operator: awp-pilot book --name ${i.agent} --contact ${address} --window-start … --window-end … --request-id … (synthetic reference service only; no real appointment)`
                : "the service endpoint is not configured (operator: awp-pilot configure-service)",
            ],
          };
        } else if ("blocked" in usable && usable.association)
          channels.push({
            kind: "remembered-scheduling-endpoint",
            status: "blocked",
            usable: false,
            detail: usable.blocked,
          });
      }
    }
    const statuses = channels.map((c) => c.status);
    const conflict =
      statuses.some((s) => ["disputed", "changed"].includes(s)) ||
      channels.some((c) => c.detail.includes("conflicts"));
    const certainty: z.infer<typeof result>["certainty"] =
      unavailable.length > 0
        ? "unavailable"
        : conflict
          ? "conflict"
          : channels.some((c) => c.usable && c.kind !== "owner-listed-address")
            ? "recorded"
            : channels.length > 0
              ? "uncertain"
              : "unknown";
    const pinned = channels.some((c) => c.status === "keys-pinned");
    return {
      status:
        certainty === "unavailable" ? "blocked" : certainty === "conflict" ? "needs-review" : "ok",
      reasons:
        certainty === "unavailable"
          ? [...unavailable, "the agent's records could not all be read; nothing is concluded"]
          : certainty === "conflict"
            ? ["conflicting or disputed records; the owner must decide"]
            : [],
      result: {
        contact: i.contact,
        certainty,
        channels,
        identity: isAddress
          ? "An email address alone does not establish identity; only pinned agent keys can, per message."
          : pinned
            ? "Operator-pinned keys are recorded for this identifier; identity is established per message, by signature verification against them."
            : "No pinned keys for this identifier: nothing here establishes its identity.",
        verification,
        ...(plan ? { plan } : {}),
      },
    };
  },
};
