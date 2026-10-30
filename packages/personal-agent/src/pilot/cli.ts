#!/usr/bin/env node
/**
 * `awp-pilot` — file/stdio interface to the pilot personal agent.
 *
 * No command sends a message, reads a mailbox or touches a provider credential. Inputs
 * are files (or stdin) the supervisor supplies; outputs are reviewed envelopes, MIME and
 * Gmail `users.messages.send` bodies written to a directory, plus a JSON report on stdout.
 * Runtime state (including synthetic private keys) lives under `--dir` (default
 * `.awp-runtime/`, git-ignored).
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { JWK } from "jose";
import { AVAILABILITY_FILE, readAvailabilityOverlay } from "./availability.js";
import { rawFromGmailMessage } from "./bindings/email.js";
import { digestOf, newUrn } from "./core/canonical.js";
import { SlotsClient, validateApiBase } from "./domains/conventional/adapter.js";
import { AssociationStore, associationDigest } from "./domains/conventional/associations.js";
import { REGISTRY } from "./domains/conventional/registry.js";
import { ConventionalScheduler } from "./domains/conventional/scheduler.js";
import type { CalendarData } from "./domains/scheduling.js";
import {
  buildMeetingTerms,
  MEETING_MODEL,
  SCHEDULE_OP,
  SyntheticCalendar,
} from "./domains/scheduling.js";
import { auditAgentDirectory, governanceManifest } from "./governance.js";
import { personalMandate } from "./mandates.js";
import {
  generateSigningKey,
  type KeyAlg,
  loadSigningKey,
  type SigningKey,
} from "./mechanisms/jws.js";
import { signApproval } from "./mechanisms/mandate.js";
import { type PolicyEngine, solidOdrlEngine } from "./mechanisms/policy-engine.js";
import { signStatement, TYP } from "./mechanisms/statements.js";
import { TrustStore, type TrustStoreData } from "./mechanisms/trust.js";
import {
  choosePolicyEngine,
  currentStatus,
  type PolicyEngineRecord,
  pinnedSparqEngine,
  policyEngineForAgent,
  type ResolvedPolicyEngine,
  readPolicyEngineRecord,
  writePolicyEngineRecord,
} from "./policy-config.js";
import { CONFIG_ED25519, CONFIG_P256 } from "./profile/configurations.js";
import { type RoleInstance, roleById } from "./roles/index.js";
import { AgentRuntime } from "./runtime/agent.js";
import type { EffectAdapter } from "./runtime/operations.js";
import {
  type InputFormat,
  NOT_SENT_NOTICE,
  type ProcessedOutbound,
  type ProcessReport,
  prepareOutbound,
  processInput,
  summariseStep,
  ThreadStore,
} from "./service.js";
import {
  agentDir,
  existingOwnerKey,
  type IntroductionCard,
  introduce,
  pinIssuer,
  provisionAgent,
  readAgent,
  readOwnerKey,
  saveAgent,
  saveTrust,
} from "./setup.js";
import { FileLedger, verifyLedger } from "./store/ledger.js";
import { FileStateStore } from "./store/state.js";

const USAGE = `awp-pilot <command> [options]

Setup (synthetic keys; nothing leaves this machine):
  init      --name N --party IRI --actor IRI [--operator IRI] [--email ADDR] [--alg EdDSA|ES256]
            [--known-party IRI]... [--known-contact ADDR]... [--timezone TZ] [--validity-days 30]
            [--policy-engine sparq|solid-odrl] [--sparq-bin PATH]
                                              SPARQ is the default policy module: init probes and
                                              pins the binary (or AWP_SPARQ_POLICY_BIN) and fails
                                              without one; solid-odrl only when chosen explicitly
            [--role ROLE]                     personal (default) or a SYNTHETIC role; list them
                                              with \`roles\`. Roles with a fixed identity omit
                                              --party/--actor; mortgage-consumer needs --wallet FILE,
                                              mortgage-lender needs --issuers FILE (local anchors)
            [--role-input KEY=VALUE]...       role inputs declared by the role (\`roles\` lists them);
                                              unknown keys are refused
            [--owner-dir DIR]                 SEPARATE owner custody: the owner key goes to
                                              DIR/<name>/ only, never into the service directory
                                              (same OS user: a filesystem boundary, not hardware
                                              custody); without it the key is colocated (compat.)
            [--owner-name ORG]                with --owner-dir: use (or create once) the SHARED
                                              organisation key DIR/ORG/ — agents of one organisation,
                                              independent actor keys; never overwritten
  roles                                       role metadata: identity, inputs, issuing key, owner
                                              statements, representation scope (all synthetic)
  issuer-card --name N                        PUBLIC card of the role's own issuing key (for peers
                                              to pin at their provisioning)
  owner-sign --name N --kind K --args JSON --owner-dir DIR
                                              the OWNER signs one statement kind the role declares
                                              (narrow, validated arguments; no free-form signing)
  synthetic-issuers --out DIR                 synthetic issuer public keys + Sam's signed wallet
  synthetic-energy --out DIR                  synthetic retailer plan files + household profile
  synthetic-health --out DIR                  synthetic FHIR R4 resources (one synthetic patient)
  synthetic-industrial --out DIR              synthetic programme issuer card + NordWerk credential
                                              (the programme's private key is discarded)
  public-config --name N --port P [--host 127.0.0.1|::1] [--out FILE]
                                              configure the loopback ANONYMOUS public listener
                                              (public services); --out writes its endpoint card
  public-pin --name N --connection FILE       pin a public service's endpoint (keys pinned first)
  sign-approval --name N --action DIGEST --conversation IRI [--deny] [--owner-dir DIR]
                                              print an OWNER-signed approval (no lock, no runtime;
                                              submit it via the MCP tool submit_approval)
  a2a-config --name N --port P [--host 127.0.0.1|::1] [--rotate] [--out FILE]
                                              configure the loopback A2A listener; --out writes the
                                              connection card (URL + access token) for the peer
  a2a-pin   --name N --connection FILE        pin a peer's loopback A2A endpoint (keys pinned first)
  policy-engine --name N [--policy-engine sparq|solid-odrl] [--sparq-bin PATH]
                                              show, or explicitly re-pin, the recorded module;
                                              exit 2 if it is unavailable (decisions fail closed)
  card     --name N                          print the public introduction card
  pin       --name N --card FILE --party-kid K --actor-kid K
                                              pin a peer card after comparing thumbprints
Operation (writes reviewed outbound files to --out; sends nothing):
  describe  --name N
  propose-meeting --name N --peer-actor IRI --peer-party IRI --window-start ISO --window-end ISO
            [--duration 30] [--title T] --out DIR
  process   --name N --input FILE|- --format eml|gmail-json|envelope --out DIR [--lenient-parity]
  approve   --name N --action DIGEST [--deny] [--owner-dir DIR] --out DIR
                                              sign (owner key) and submit in one local process
  reconcile --name N --out DIR                (alias: recover) settle uncertain effects,
                                              re-emit outbound items not yet handed off
  revoke-mandate --name N                     persisted; survives restart
  status    --name N
  verify-ledger --name N
  governance [--name N] [--out FILE]          resource-governance metadata (no CDMC claim);
                                              with --name: exit 2 if a retained file is unregistered
  serve    --name N --spool DIR [--interval-ms 2000] [--once]
            prints one JSON readiness line, then one JSON line per processed file
  mcp       --name N [--a2a] [--public] [--auto-dispatch]
                                              local MCP server on stdio (the agent's single runtime
                                              owner while it runs; stdout = MCP, stderr = logs);
                                              --a2a also runs the loopback A2A listener and
                                              dispatches to pinned A2A peers; --public the
                                              anonymous public listener / public requests;
                                              --auto-dispatch (alias --a2a-auto-dispatch) sends
                                              queued outbound without an operator call
Conventional scheduling links (UC-02; LOCAL SYNTHETIC reference service, not Calendly):
  configure-service --name N --service synthetic-slots/1 --api-base URL
                                              the only source of a request target
  remember-link --name N --input FILE|- [--format eml|gmail-json]
                                              record candidate associations (never fetched)
  associations  --name N
  confirm-association --name N --id ID [--deny] [--owner-dir DIR]
                                              owner-signed promotion or rejection
  book      --name N --contact ADDR --window-start ISO --window-end ISO [--duration 30]
            --request-id ID                   exit 0 booked, 3 uncertain, 2 otherwise
Demo:
  demo      [--out reports/pilot-demo-report.json] [--only P1,M,...]
            [--policy-engine sparq|solid-odrl] [--sparq-bin PATH]
                                              module for every scenario runtime and enforcement
                                              point (harness default solid-odrl; recorded in report)
Common: --dir DIR (default .awp-runtime)  --now ISO (synthetic clock)`;

type Opts = Record<string, string | boolean | string[] | undefined>;

function opt(o: Opts, key: string): string | undefined {
  const v = o[key];
  return typeof v === "string" ? v : undefined;
}

function need(o: Opts, key: string): string {
  const v = opt(o, key);
  if (!v) throw new Error(`missing --${key}`);
  return v;
}

function defaultCalendar(timeZone: string): CalendarData {
  return {
    timeZone,
    workingHours: { start: "09:00", end: "17:00", days: [1, 2, 3, 4, 5] },
    busy: [],
    holds: {},
  };
}

export interface OpenAgent {
  rt: AgentRuntime;
  calendar: SyntheticCalendar;
  threads: ThreadStore;
  email?: string;
  scheduler: ConventionalScheduler;
  associations: AssociationStore;
  policy: ResolvedPolicyEngine;
  /** The agent directory (local only; never shared with peers). */
  dir: string;
  name: string;
  /** The pinned trust data the runtime loaded (read-only view). */
  trustData: TrustStoreData;
  /** The role this directory hosts (`personal`, `mortgage-lender`, …) and its instance. */
  role: string;
  domain: RoleInstance;
  /** Set when opening took over a lock left by a dead process (pid of that process). */
  recoveredStaleLockPid?: number;
  close(): void;
}

/**
 * SYNTHETIC FAULT INJECTION for the separate-process integration workflow only: with
 * AWP_SYNTHETIC_FAULT=calendar-kill-after-commit the process kills itself (SIGKILL) right
 * after the calendar hold commits — a crash between effect and conclusion. Ignored otherwise.
 */
function faultWrap(adapter: EffectAdapter): EffectAdapter {
  if (process.env.AWP_SYNTHETIC_FAULT !== "calendar-kill-after-commit") return adapter;
  return {
    id: adapter.id,
    async execute(key, params) {
      await adapter.execute(key, params);
      process.kill(process.pid, "SIGKILL");
      return new Promise(() => {});
    },
    reconcile: (key, params) => adapter.reconcile(key, params),
  };
}

/**
 * The policy module for an in-process run that has no agent directory (the demo): selected
 * explicitly by flag or `AWP_POLICY_ENGINE` (`sparq` needs a probed binary); anything else is
 * an error, and a selected SPARQ module never falls back.
 */
function harnessPolicyEngine(o: Opts): { module: string; engine: PolicyEngine } {
  const record = choosePolicyEngine({
    engine: opt(o, "policy-engine") ?? process.env.AWP_POLICY_ENGINE ?? "solid-odrl",
    ...(opt(o, "sparq-bin") ? { sparqBin: opt(o, "sparq-bin") as string } : {}),
    env: process.env,
    now: new Date(),
  });
  return record.engine === "sparq"
    ? { module: `sparq (${record.evaluator})`, engine: pinnedSparqEngine(record) }
    : { module: `solid-odrl (${record.evaluator})`, engine: solidOdrlEngine };
}

/**
 * Run a configuration change under the agent's single-writer state lock, so it is refused
 * (StateLockedError) while a service (`serve`/`mcp`) owns the agent and never changes a
 * running process underneath it.
 */
function withAgentLock(dir: string, fn: () => void): void {
  const lock = new FileStateStore(join(dir, "state.json"));
  try {
    fn();
  } finally {
    lock.close();
  }
}

/** The policy module for an agent directory — one resolution for runtime AND inspection. */
export function agentPolicy(stored: { dir: string; identity: unknown }): ResolvedPolicyEngine {
  const identity = stored.identity as { policyModuleRecorded?: boolean };
  return policyEngineForAgent(stored.dir, process.env, {
    recordRequired: identity.policyModuleRecorded === true,
  });
}

/**
 * Open an agent directory as its single runtime owner (takes the state lock). Shared by the
 * CLI commands, the spool service and the MCP server — one runtime implementation.
 */
export async function openAgent(
  root: string,
  name: string,
  now: () => Date,
  options: { extraBindings?: readonly { id: string; endpoint?: string }[] } = {},
): Promise<OpenAgent> {
  const stored = await readAgent(root, name);
  const identity = stored.identity as typeof stored.identity & {
    timeZone?: string;
    policyModuleRecorded?: boolean;
    role?: string;
  };
  // Only personal agents keep a (synthetic) calendar file; other roles have no calendar state.
  // Whether it existed BEFORE this open (which creates a default one) matters below: under owner
  // availability settings a missing calendar is NOT recreated (an in-memory stand-in is used and
  // scheduling is blocked), so a lost calendar stays visibly lost instead of becoming "empty".
  const hadCalendar = existsSync(join(stored.dir, "calendar.json"));
  const ownerManaged = existsSync(join(stored.dir, AVAILABILITY_FILE));
  const calendar =
    (identity.role ?? "personal") === "personal" && (hadCalendar || !ownerManaged)
      ? SyntheticCalendar.open(
          join(stored.dir, "calendar.json"),
          defaultCalendar(identity.timeZone ?? "UTC"),
        )
      : new SyntheticCalendar(defaultCalendar(identity.timeZone ?? "UTC"));
  // Operator-configured endpoints for remembered services (local, reviewed configuration).
  const servicesPath = join(stored.dir, "services.json");
  const services = existsSync(servicesPath)
    ? (JSON.parse(readFileSync(servicesPath, "utf8")) as Record<string, string>)
    : {};
  const clients = new Map(
    Object.entries(services).map(([id, base]) => [id, new SlotsClient(base, 2_000)]),
  );
  const policy = agentPolicy(stored);
  // Take the single-writer lock BEFORE the role opens any durable domain state.
  const store = new FileStateStore(join(stored.dir, "state.json"));
  // From here on, EVERY startup failure releases the lock (and the runtime, if created).
  let created: AgentRuntime | undefined;
  try {
    // Owner availability settings (dashboard), read once AFTER taking the lock, so a file
    // written before the lock's time is the one in use; a later change applies at next start.
    if ((identity.role ?? "personal") === "personal") {
      const overlay = readAvailabilityOverlay(stored.dir);
      // Under owner availability settings, a calendar that was expected (the dashboard only
      // applies ready settings for an initialised calendar) but is missing means its busy time
      // and holds were lost: fail closed instead of starting from an empty calendar. Agents
      // without owner settings keep the original behaviour (a default calendar on first open).
      calendar.overlay =
        overlay && !overlay.blocked && !hadCalendar
          ? {
              ...overlay,
              blocked: {
                reason:
                  "the agent's calendar data is missing, so its busy time is unknown (fails closed)",
              },
            }
          : overlay;
    }
    return await openLocked();
  } catch (error) {
    if (created) created.close();
    else store.close();
    throw error;
  }

  async function openLocked(): Promise<OpenAgent> {
    const role = roleById(identity.role);
    const issuerKey = role.issuingKey ? await readIssuerKey(stored.dir) : undefined;
    const domain: RoleInstance = role.build({
      dir: stored.dir,
      now,
      engine: policy.engine,
      party: identity.party,
      actor: identity.actor,
      calendar,
      clients,
      wrapEffect: faultWrap,
      trust: stored.trust as TrustStoreData,
      ...(issuerKey ? { issuerKey } : {}),
    });
    const rt = await AgentRuntime.create({
      identity: {
        actor: identity.actor,
        party: identity.party,
        ...(identity.operator ? { operator: identity.operator } : {}),
      },
      actorKeys: [stored.actorKey],
      trust: await TrustStore.load(stored.trust),
      mandateJws: stored.mandateJws,
      representationJws: stored.representationJws,
      accepted: identity.accepted,
      handlers: domain.handlers,
      effects: domain.effects,
      ...(domain.disclosureChecks ? { disclosureChecks: domain.disclosureChecks } : {}),
      store,
      ledger: new FileLedger(join(stored.dir, "ledger.jsonl")),
      now,
      // Outbound files count as delivered only once written; anything else is re-emitted.
      trackHandOff: true,
      policyEngine: policy.engine,
      // Advertise only the bindings THIS process serves (the MCP server adds its own).
      bindings: [
        { id: "direct-local/0.1" },
        ...(identity.email ? [{ id: "email-mime/0.1", endpoint: `mailto:${identity.email}` }] : []),
        ...(options.extraBindings ?? []),
      ],
    });
    created = rt;
    const mandate = rt.mandateStatus();
    if (!mandate.loaded && /not a valid IRI/.test(mandate.failure ?? "")) {
      // Signed statements are never rewritten: an agent initialised by pilot profile 0.1.0 (which
      // minted `<actor#frag>#…` identifiers) must be re-initialised (explicit migration).
      throw new Error(
        `agent ${name} was initialised by pilot profile 0.1.0 with identifiers that are not valid IRIs; ` +
          "re-run `init` for this agent (signed statements are not migrated automatically)",
      );
    }
    const associations = new AssociationStore(join(stored.dir, "associations.json"));
    const scheduler = new ConventionalScheduler({
      runtime: rt,
      trust: await TrustStore.load(stored.trust),
      store: associations,
      clients,
      owner: {
        actor: identity.actor,
        name: identity.name,
        email: identity.email ?? "owner@example.invalid",
        calendar,
      },
      now,
    });
    return {
      rt,
      calendar,
      threads: new ThreadStore(join(stored.dir, "threads.json")),
      ...(identity.email ? { email: identity.email } : {}),
      scheduler,
      associations,
      policy,
      dir: stored.dir,
      name,
      trustData: stored.trust as TrustStoreData,
      role: role.id,
      domain,
      ...(store.recoveredStaleLock ? { recoveredStaleLockPid: store.recoveredStaleLock.pid } : {}),
      close: () => rt.close(),
    };
  }
}

/** A role's own ISSUING key (service directory, 0600): not the owner key, not the actor key. */
export const ISSUER_KEY_FILE = "keys/issuer.private.jwk.json";

async function readIssuerKey(dir: string): Promise<SigningKey> {
  const path = join(dir, ISSUER_KEY_FILE);
  if (!existsSync(path)) throw new Error("this role's issuing key is missing (re-run init)");
  const k = JSON.parse(readFileSync(path, "utf8")) as { alg: KeyAlg; jwk: JWK };
  return loadSigningKey(k.jwk, k.alg);
}

/** Parse repeated `--role-input key=value` options. */
function roleInputs(o: Opts): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of (o["role-input"] as string[] | undefined) ?? []) {
    const at = kv.indexOf("=");
    if (at < 1) throw new Error(`--role-input expects key=value, got ${kv}`);
    out[kv.slice(0, at)] = kv.slice(at + 1);
  }
  return out;
}

function safeName(id: string): string {
  return id.replace(/[^A-Za-z0-9]+/g, "-").slice(-40);
}

/** Write reviewed outbound items; returns the file list. */
function writeOutbound(outDir: string, items: readonly ProcessedOutbound[]): string[] {
  mkdirSync(outDir, { recursive: true });
  const files: string[] = [];
  items.forEach((item, i) => {
    const stem = join(
      outDir,
      `${String(i + 1).padStart(2, "0")}-${item.kind}-${safeName(item.id)}`,
    );
    // A protected disclosure whose basis does not hold now is not written (review file only).
    if (!item.withheld) {
      writeFileSync(`${stem}.envelope.json`, JSON.stringify(item.envelope, null, 2));
      files.push(`${stem}.envelope.json`);
    }
    if (item.email && !item.withheld) {
      writeFileSync(`${stem}.eml`, item.email.raw);
      writeFileSync(`${stem}.gmail-send.json`, JSON.stringify(item.email.gmailSend, null, 2));
      files.push(`${stem}.eml`, `${stem}.gmail-send.json`);
    }
    writeFileSync(
      `${stem}.review.json`,
      JSON.stringify(
        {
          id: item.id,
          kind: item.kind,
          toActor: item.toActor,
          to: item.email?.to,
          status: item.status,
          ...(item.withheld ? { withheld: item.withheld } : {}),
          checks: item.checks,
        },
        null,
        2,
      ),
    );
    files.push(`${stem}.review.json`);
  });
  return files;
}

/**
 * Write reviewed items, THEN record them as handed off (a crash in between re-emits them on
 * the next run; the receiver treats a re-emitted message id as a duplicate).
 */
async function writeAndHandOff(
  a: OpenAgent,
  outDir: string,
  items: readonly ProcessedOutbound[],
): Promise<string[]> {
  const files = writeOutbound(outDir, items);
  if (items.length === 0) return files;
  await a.rt.markHandedOff(items.filter((i) => i.status !== "blocked").map((i) => i.id));
  return files;
}

/** Finish interrupted work and re-emit anything never handed off (crash recovery). */
async function flushPending(a: OpenAgent, outDir: string, now: () => Date): Promise<string[]> {
  await a.rt.recover();
  const pending = a.rt.undeliveredOutbound();
  if (pending.length === 0) return [];
  const items = await prepareOutbound(
    a.rt,
    pending,
    a.email ? { selfAddress: a.email } : {},
    a.threads,
    now(),
  );
  return writeAndHandOff(a, outDir, items);
}

function reportWithoutRaw(report: ProcessReport) {
  return {
    ...report,
    outbound: report.outbound.map((o) => ({
      id: o.id,
      kind: o.kind,
      toActor: o.toActor,
      status: o.status,
      checks: o.checks,
      ...(o.email
        ? {
            email: {
              to: o.email.to,
              from: o.email.from,
              subject: o.email.subject,
              emailMessageId: o.email.emailMessageId,
            },
          }
        : {}),
    })),
  };
}

function formatFromName(file: string): InputFormat | undefined {
  if (file.endsWith(".eml")) return "eml";
  if (file.endsWith(".gmail.json")) return "gmail-json";
  if (file.endsWith(".envelope.json")) return "envelope";
  return undefined;
}

export async function main(
  argv: readonly string[],
  io: { stdout: (s: string) => void; stdin?: () => Promise<Buffer> } = {
    stdout: (s) => process.stdout.write(s),
  },
): Promise<number> {
  const [command, ...rest] = argv;
  const { values } = parseArgs({
    args: rest,
    options: {
      dir: { type: "string" },
      name: { type: "string" },
      party: { type: "string" },
      actor: { type: "string" },
      operator: { type: "string" },
      email: { type: "string" },
      alg: { type: "string" },
      "known-party": { type: "string", multiple: true },
      "known-contact": { type: "string", multiple: true },
      service: { type: "string" },
      "api-base": { type: "string" },
      contact: { type: "string" },
      "request-id": { type: "string" },
      id: { type: "string" },
      only: { type: "string" },
      timezone: { type: "string" },
      "validity-days": { type: "string" },
      card: { type: "string" },
      "party-kid": { type: "string" },
      "actor-kid": { type: "string" },
      "peer-actor": { type: "string" },
      "peer-party": { type: "string" },
      "window-start": { type: "string" },
      "window-end": { type: "string" },
      duration: { type: "string" },
      title: { type: "string" },
      input: { type: "string" },
      format: { type: "string" },
      out: { type: "string" },
      "lenient-parity": { type: "boolean" },
      action: { type: "string" },
      deny: { type: "boolean" },
      spool: { type: "string" },
      "interval-ms": { type: "string" },
      once: { type: "boolean" },
      now: { type: "string" },
      "policy-engine": { type: "string" },
      "sparq-bin": { type: "string" },
      role: { type: "string" },
      wallet: { type: "string" },
      issuers: { type: "string" },
      conversation: { type: "string" },
      port: { type: "string" },
      host: { type: "string" },
      rotate: { type: "boolean" },
      connection: { type: "string" },
      a2a: { type: "boolean" },
      public: { type: "boolean" },
      "auto-dispatch": { type: "boolean" },
      "owner-dir": { type: "string" },
      "owner-name": { type: "string" },
      "role-input": { type: "string", multiple: true },
      kind: { type: "string" },
      args: { type: "string" },
      "a2a-auto-dispatch": { type: "boolean" },
    },
    strict: true,
  });
  const o = values as Opts;
  const root = resolve(opt(o, "dir") ?? ".awp-runtime");
  const fixedNow = opt(o, "now");
  const now = () => (fixedNow ? new Date(fixedNow) : new Date());
  const print = (v: unknown) => io.stdout(`${JSON.stringify(v, null, 2)}\n`);

  switch (command) {
    case "init": {
      const alg = (opt(o, "alg") ?? "EdDSA") as KeyAlg;
      if (alg !== "EdDSA" && alg !== "ES256") throw new Error("--alg must be EdDSA or ES256");
      const known = (o["known-party"] as string[] | undefined) ?? [];
      const validity = Number.parseInt(opt(o, "validity-days") ?? "30", 10);
      const role = roleById(opt(o, "role"));
      if (role.identity && (opt(o, "party") || opt(o, "actor") || opt(o, "operator")))
        throw new Error(`role ${role.id} has a fixed synthetic identity; omit --party/--actor`);
      const identity = {
        name: need(o, "name"),
        ...(role.identity
          ? { ...role.identity }
          : {
              party: need(o, "party"),
              actor: need(o, "actor"),
              ...(opt(o, "operator") ? { operator: opt(o, "operator") as string } : {}),
            }),
        ...(opt(o, "email") ? { email: opt(o, "email") as string } : {}),
      };
      // The policy module is chosen and probed BEFORE anything is written (SPARQ by default).
      const policyRecord = choosePolicyEngine({
        ...(opt(o, "policy-engine") ? { engine: opt(o, "policy-engine") as string } : {}),
        ...(opt(o, "sparq-bin") ? { sparqBin: opt(o, "sparq-bin") as string } : {}),
        env: process.env,
        now: now(),
      });
      // Several actors of ONE organisation may share its owner key (--owner-name ORG): the
      // first `init` creates it in the owner directory, later ones reuse it (never overwrite).
      const ownerDir = opt(o, "owner-dir");
      const ownerName = opt(o, "owner-name");
      if (ownerName && !ownerDir) throw new Error("--owner-name needs --owner-dir");
      const shared =
        ownerDir && ownerName ? await existingOwnerKey(resolve(ownerDir), ownerName) : undefined;
      const p = await provisionAgent({
        identity,
        alg,
        now: now(),
        mandate: role.mandate
          ? role.mandate()
          : personalMandate({
              knownParties: known,
              knownContacts: (o["known-contact"] as string[] | undefined) ?? [],
            }),
        representationOperations: [...role.representationOperations],
        validityDays: validity,
        ...(shared ? { existingOwnerKey: shared } : {}),
      });
      // Role provisioning is LOCAL and validated before anything is written: source-authority
      // anchors and the wallet come from files the operator supplies here, never from a channel.
      const inputs = {
        ...roleInputs(o),
        ...(opt(o, "wallet") ? { wallet: opt(o, "wallet") } : {}),
        ...(opt(o, "issuers") ? { issuers: opt(o, "issuers") } : {}),
      };
      const unknownInputs = Object.keys(inputs).filter(
        (k) => !["wallet", "issuers"].includes(k) && !(role.inputs && k in role.inputs),
      );
      if (unknownInputs.length > 0)
        throw new Error(`role ${role.id} does not take inputs: ${unknownInputs.join(", ")}`);
      const provisioned = role.init
        ? await role.init({ trust: p.trust, now: now(), options: inputs })
        : { trust: p.trust };
      const issuing = role.issuingKey ? await generateSigningKey(alg) : undefined;
      // The role verifies statements it issued itself (e.g. a grant named in a revocation)
      // against its own PUBLIC issuing key, pinned like any other issuer.
      const trust =
        issuing && role.issuingKey
          ? pinIssuer(
              provisioned.trust,
              role.issuingKey.subject,
              issuing.key,
              "this service's own issuing key",
            )
          : provisioned.trust;
      const dir = saveAgent(
        root,
        { ...p, trust },
        role.accepted ? [...role.accepted] : [alg === "EdDSA" ? CONFIG_ED25519 : CONFIG_P256],
        ownerDir
          ? {
              ownerDir: resolve(ownerDir),
              ...(ownerName ? { ownerName } : {}),
              ...(shared ? { reuseOwnerKey: true } : {}),
            }
          : {},
      );
      if (issuing)
        writeFileSync(
          join(dir, ISSUER_KEY_FILE),
          JSON.stringify({ alg: issuing.key.alg, jwk: issuing.privateJwk }),
          { mode: 0o600 },
        );
      for (const [file, value] of Object.entries(provisioned.files ?? {}))
        writeFileSync(join(dir, basename(file)), JSON.stringify(value, null, 2), { mode: 0o600 });
      writePolicyEngineRecord(dir, policyRecord);
      const idFile = join(dir, "identity.json");
      writeFileSync(
        idFile,
        JSON.stringify(
          {
            ...JSON.parse(readFileSync(idFile, "utf8")),
            timeZone: opt(o, "timezone") ?? "UTC",
            policyModuleRecorded: true,
            role: role.id,
          },
          null,
          2,
        ),
      );
      print({
        dir,
        party: p.card.party,
        actor: p.card.actor,
        partyKid: p.card.partyKey.kid,
        actorKid: p.card.actorKey.kid,
        policyModule: policyRecord,
        ownerCustody: ownerDir
          ? shared
            ? `separate: reused the existing owner key '${ownerName}' in the owner directory (same organisation; same OS user; not hardware custody)`
            : "separate: the owner key was written to the owner directory only (same OS user; not hardware custody)"
          : "colocated: the owner key is in the service directory (compatibility; use --owner-dir for separate custody)",
        ...(issuing ? { issuerKid: issuing.key.kid } : {}),
        note: "synthetic test keys written with mode 0600; compare these thumbprints out of band before a peer pins this card",
      });
      return 0;
    }
    case "policy-engine": {
      // Show, or explicitly change/re-pin, the recorded policy module (an operator action).
      const stored = await readAgent(root, need(o, "name"));
      if (opt(o, "policy-engine") || opt(o, "sparq-bin")) {
        // Re-pinning takes the agent's single-writer lock: it is refused while a service
        // (serve/mcp) owns this agent, so a running process never has its policy module
        // changed underneath it — the new module applies from the next start. The change is
        // recorded in the agent's hash-chained ledger.
        const lock = new FileStateStore(join(stored.dir, "state.json"));
        try {
          const previous = readPolicyEngineRecord(stored.dir);
          const record = choosePolicyEngine({
            engine: opt(o, "policy-engine") ?? previous?.engine ?? "sparq",
            ...(opt(o, "sparq-bin") ? { sparqBin: opt(o, "sparq-bin") as string } : {}),
            env: process.env,
            now: now(),
          });
          writePolicyEngineRecord(stored.dir, {
            ...record,
            ...(previous
              ? {
                  replaced: {
                    engine: previous.engine,
                    evaluator: previous.evaluator,
                    recordedAt: previous.recordedAt,
                  },
                }
              : {}),
          } as PolicyEngineRecord);
          new FileLedger(join(stored.dir, "ledger.jsonl")).append(
            {
              type: "policy-module-recorded",
              engine: record.engine,
              evaluator: record.evaluator,
              ...(record.engine === "sparq" ? { sha256: record.sha256 } : {}),
              ...(previous ? { replaced: previous.engine } : {}),
              note: "operator re-pin; takes effect at the next start of the agent",
            },
            now().toISOString(),
          );
        } finally {
          lock.close();
        }
      }
      // The SAME resolution the runtime uses (a missing record in a recorded directory is
      // unavailable, not a legacy default).
      const resolved = agentPolicy(stored);
      const status = currentStatus(resolved);
      print({
        module: resolved.module,
        source: resolved.source,
        status,
        record: resolved.record ?? null,
      });
      return status.startsWith("unavailable") ? 2 : 0;
    }
    case "card": {
      print((await readAgent(root, need(o, "name"))).card);
      return 0;
    }
    case "pin": {
      const name = need(o, "name");
      const stored = await readAgent(root, name);
      const card = JSON.parse(readFileSync(need(o, "card"), "utf8")) as IntroductionCard;
      const trust = introduce(stored.trust, card, {
        party: need(o, "party-kid"),
        actor: need(o, "actor-kid"),
      });
      await TrustStore.load(trust);
      // Trust changes take the single-writer lock: refused while a service owns the agent.
      withAgentLock(stored.dir, () => saveTrust(root, name, trust));
      print({ pinned: { party: card.party, actor: card.actor, endpoints: card.endpoints } });
      return 0;
    }
    case "describe": {
      const a = await openAgent(root, need(o, "name"), now);
      try {
        print(a.rt.description());
      } finally {
        a.close();
      }
      return 0;
    }
    case "status": {
      const a = await openAgent(root, need(o, "name"), now);
      try {
        print({
          policyModule: {
            module: a.policy.module,
            source: a.policy.source,
            status: currentStatus(a.policy),
          },
          conversations: a.rt.conversations().map((c) => ({
            id: c.id,
            role: c.role,
            peer: c.peer,
            phase: c.phase,
            closedReason: c.closedReason,
            outcomes: c.outcomes,
            agreement: c.agreement,
          })),
          pendingApprovals: a.rt.pendingApprovals(),
          effects: a.rt
            .effectStates()
            .map((e) => ({ key: e.key, status: e.status, conclusion: e.conclusion })),
          role: a.role,
          ...(a.role === "personal" ? { holds: a.calendar.data.holds } : {}),
          ...(a.domain.status ? { domain: a.domain.status() } : {}),
        });
      } finally {
        a.close();
      }
      return 0;
    }
    case "sign-approval": {
      // The OWNER's decision, signed with the owner key and printed — nothing else. It takes no
      // lock, opens no runtime and reads no agent private key: only the owner key (from
      // --owner-dir, or a colocated compatibility key) and the agent's PUBLIC identity. The
      // running service verifies it (owner signature, exact pending action) when submitted.
      const name = need(o, "name");
      const owner = await readOwnerKey(root, name, opt(o, "owner-dir"));
      const identity = JSON.parse(
        readFileSync(join(agentDir(root, name), "identity.json"), "utf8"),
      ) as {
        party: string;
        actor: string;
      };
      const decision = o.deny ? "deny" : "approve";
      const approval = await signApproval(owner.key, {
        type: "OwnerApproval",
        id: newUrn(),
        issuer: identity.party,
        actor: identity.actor,
        actionDigest: need(o, "action"),
        conversation: need(o, "conversation"),
        decision,
        issuedAt: now().toISOString(),
        validUntil: new Date(now().getTime() + 3_600_000).toISOString(),
        note: "synthetic owner decision signed via CLI (owner key), submitted separately",
      });
      print({
        approval,
        actionDigest: need(o, "action"),
        conversation: need(o, "conversation"),
        decision,
        ownerCustody: owner.custody,
        note: "submit with the MCP tool submit_approval; it binds to exactly this pending action",
      });
      return 0;
    }
    case "roles": {
      // Discoverable role metadata (what `init --role` provisions). The exact operator tools of
      // a running agent are listed by its MCP server (tools/list) and `get_profile`.
      const { ROLES } = await import("./roles/index.js");
      print(
        Object.values(ROLES).map((r) => ({
          id: r.id,
          label: r.label,
          synthetic: r.synthetic,
          fixedIdentity: r.identity ?? null,
          representationOperations: r.representationOperations,
          accepted: r.accepted ?? "signed configuration for the key algorithm",
          inputs: r.inputs ?? {},
          issuingKey: r.issuingKey ?? null,
          ownerStatements: Object.fromEntries(
            Object.entries(r.ownerStatements ?? {}).map(([k, v]) => [
              k,
              { description: v.description, args: Object.keys(v.args) },
            ]),
          ),
        })),
      );
      return 0;
    }
    case "issuer-card": {
      // PUBLIC card of a role's own issuing key, for peers to pin at THEIR provisioning.
      const name = need(o, "name");
      const stored = await readAgent(root, name);
      const role = roleById((stored.identity as { role?: string }).role);
      if (!role.issuingKey) throw new Error(`role ${role.id} has no issuing key`);
      const key = await readIssuerKey(stored.dir);
      print({
        version: 1,
        issuers: [
          {
            issuer: role.issuingKey.subject,
            kid: key.kid,
            alg: key.alg,
            publicJwk: key.publicJwk,
          },
        ],
        note: role.issuingKey.note,
      });
      return 0;
    }
    case "owner-sign": {
      // The OWNER signs one statement of a kind the agent's ROLE declares (narrow arguments,
      // validated payload); no lock, no runtime, no actor key. Owner key from --owner-dir.
      const name = need(o, "name");
      const identity = JSON.parse(
        readFileSync(join(agentDir(root, name), "identity.json"), "utf8"),
      ) as { party: string; actor: string; role?: string };
      const card = JSON.parse(readFileSync(join(agentDir(root, name), "card.json"), "utf8")) as {
        actorKey: { kid: string };
      };
      const role = roleById(identity.role);
      const kindName = need(o, "kind");
      const kind = role.ownerStatements?.[kindName];
      if (!kind)
        throw new Error(
          `role ${role.id} declares no owner statement '${kindName}' (${Object.keys(role.ownerStatements ?? {}).join(", ") || "none"})`,
        );
      const { z } = await import("zod");
      const args = z.strictObject(kind.args).parse(JSON.parse(need(o, "args")));
      const payload = kind.build(args, {
        party: identity.party,
        actor: identity.actor,
        actorKid: card.actorKey.kid,
        now: now(),
      });
      const owner = await readOwnerKey(root, name, opt(o, "owner-dir"));
      print({
        kind: kindName,
        statement: await signStatement(owner.key, TYP.statement, payload),
        payload,
        ownerCustody: owner.custody,
      });
      return 0;
    }
    case "public-config": {
      // Configure this agent's loopback ANONYMOUS public listener (a public service).
      const pub = await import("./bindings/public-http.js");
      const stored = await readAgent(root, need(o, "name"));
      let config: ReturnType<typeof pub.configurePublic> | undefined;
      withAgentLock(stored.dir, () => {
        config = pub.configurePublic(stored.dir, {
          ...(opt(o, "host") ? { host: opt(o, "host") as string } : {}),
          port: Number.parseInt(need(o, "port"), 10),
        });
      });
      const card = pub.endpointCard(config as NonNullable<typeof config>, stored.identity.actor);
      if (opt(o, "out")) writeFileSync(need(o, "out"), JSON.stringify(card, null, 2));
      print({ endpoint: card, ...(opt(o, "out") ? { written: need(o, "out") } : {}) });
      return 0;
    }
    case "public-pin": {
      // Pin a public service's endpoint (after its keys were pinned with `pin`).
      const pub = await import("./bindings/public-http.js");
      const stored = await readAgent(root, need(o, "name"));
      const raw = JSON.parse(readFileSync(need(o, "connection"), "utf8")) as unknown;
      let peer: { actor: string; url: string } | undefined;
      withAgentLock(stored.dir, () => {
        peer = pub.pinPublicPeer(stored.dir, stored.trust as TrustStoreData, raw);
      });
      print({ pinned: peer });
      return 0;
    }
    case "synthetic-energy": {
      // SYNTHETIC energy inputs: one plans file per fixture retailer and the comparator's
      // LOCAL household profile. Nothing real; not CDS-conformant.
      const f = await import("./fixtures/energy.js");
      const { syntheticUsageCurve } = await import("./domains/energy.js");
      const out = resolve(need(o, "out"));
      mkdirSync(out, { recursive: true });
      const files: Record<string, string> = {};
      const write = (name: string, value: unknown) => {
        files[name] = join(out, name);
        writeFileSync(files[name] as string, JSON.stringify(value, null, 2), { mode: 0o600 });
      };
      write("plans-southern-current.json", {
        version: 1,
        model: "current",
        access: "public",
        plans: f.SOUTHERN_PLANS,
      });
      write("plans-harbour-light.json", {
        version: 1,
        model: "current",
        access: "public",
        plans: f.HARBOUR_PLANS,
      });
      write("plans-gated-power.json", {
        version: 1,
        model: "current",
        access: "represented",
        plans: [],
      });
      write("plans-oldschema-energy.json", {
        version: 1,
        model: "old",
        access: "public",
        plans: f.SOUTHERN_PLANS,
      });
      write("household.json", f.syntheticHousehold(syntheticUsageCurve()));
      print({
        files,
        retailers: [f.SOUTHERN, f.HARBOUR, f.GATED, f.OLDSCHEMA].map((r) => ({
          name: r.name,
          party: r.party,
          actor: r.actor,
        })),
        note: "synthetic tariffs and usage; the household profile stays with the comparator",
      });
      return 0;
    }
    case "synthetic-health": {
      // SYNTHETIC FHIR R4 resources for ONE wholly synthetic patient (hand-authored fixtures).
      const { syntheticResources, syntheticSecondPatientResources } = await import(
        "./domains/fhir.js"
      );
      const { PATIENT_ID, NOAH_PATIENT_ID, syntheticEnrollments } = await import(
        "./fixtures/health.js"
      );
      const out = resolve(need(o, "out"));
      mkdirSync(out, { recursive: true });
      const file = join(out, "fhir-resources.json");
      writeFileSync(
        file,
        JSON.stringify(
          {
            version: 2,
            patientIds: [PATIENT_ID, NOAH_PATIENT_ID],
            resources: [
              ...syntheticResources(PATIENT_ID),
              ...syntheticSecondPatientResources(NOAH_PATIENT_ID),
            ],
            synthetic: true,
          },
          null,
          2,
        ),
        { mode: 0o600 },
      );
      // The CLINIC's register (principal → compartment) for the authorisation service.
      const enrollments = join(out, "patient-enrollments.json");
      writeFileSync(enrollments, JSON.stringify(syntheticEnrollments(now()), null, 2), {
        mode: 0o600,
      });
      print({
        resources: file,
        enrollments,
        patientIds: [PATIENT_ID, NOAH_PATIENT_ID],
        note: "synthetic records and enrollments; not clinical data",
      });
      return 0;
    }
    case "synthetic-industrial": {
      // SYNTHETIC programme issuance for the industrial slice: a fresh test-programme key signs
      // ONE participant credential for NordWerk; only its PUBLIC card is written (for the
      // provider's local pinning) and the private key is discarded.
      const { syntheticProgramme } = await import("./fixtures/industrial.js");
      const out = resolve(need(o, "out"));
      mkdirSync(out, { recursive: true });
      const p = await syntheticProgramme(now());
      const files = {
        programmeIssuer: join(out, "programme-issuer.json"),
        membership: join(out, "nordwerk-membership.json"),
      };
      writeFileSync(files.programmeIssuer, JSON.stringify(p.issuers, null, 2), { mode: 0o600 });
      writeFileSync(files.membership, JSON.stringify(p.membership, null, 2), { mode: 0o600 });
      print({
        ...files,
        note: "synthetic test programme (issuer private key discarded); not a data space membership",
      });
      return 0;
    }
    case "synthetic-issuers": {
      // SYNTHETIC issuance for the mortgage slice: fresh issuer keys sign Sam's wallet; only
      // the issuers' PUBLIC keys are written (for the lender's local pinning). Issuer private
      // keys are discarded — nothing here can issue more evidence later.
      const { issuerPublicKeys, newSyntheticIssuers, samWallet } = await import(
        "./fixtures/mortgage.js"
      );
      const out = resolve(need(o, "out"));
      mkdirSync(out, { recursive: true });
      const issuers = await newSyntheticIssuers();
      const pub = join(out, "issuers.public.json");
      const wallet = join(out, "wallet-sam.json");
      writeFileSync(
        pub,
        JSON.stringify({ version: 1, issuers: issuerPublicKeys(issuers) }, null, 2),
      );
      writeFileSync(
        wallet,
        JSON.stringify({ version: 1, items: await samWallet(issuers) }, null, 2),
        { mode: 0o600 },
      );
      print({
        issuers: pub,
        wallet,
        note: "synthetic issuers and evidence; issuer private keys were not persisted",
      });
      return 0;
    }
    case "a2a-config": {
      // Configure this agent's loopback A2A listener (applies at the next `mcp --a2a` start).
      const { configureA2a, connectionCard } = await import("./bindings/a2a.js");
      const stored = await readAgent(root, need(o, "name"));
      let config: ReturnType<typeof configureA2a> | undefined;
      withAgentLock(stored.dir, () => {
        config = configureA2a(stored.dir, {
          ...(opt(o, "host") ? { host: opt(o, "host") as string } : {}),
          port: Number.parseInt(need(o, "port"), 10),
          rotate: Boolean(o.rotate),
        });
      });
      const connection = connectionCard(
        config as NonNullable<typeof config>,
        stored.identity.actor,
      );
      if (opt(o, "out"))
        writeFileSync(need(o, "out"), JSON.stringify(connection, null, 2), { mode: 0o600 });
      print({
        connection: { ...connection, token: "(written to --out; exchange out of band)" },
        ...(opt(o, "out") ? { written: need(o, "out") } : {}),
      });
      return 0;
    }
    case "a2a-pin": {
      // Pin a peer's A2A endpoint + access token (after its keys were pinned with `pin`).
      const { pinA2aPeer } = await import("./bindings/a2a.js");
      const stored = await readAgent(root, need(o, "name"));
      const raw = JSON.parse(readFileSync(need(o, "connection"), "utf8")) as unknown;
      let peer: { actor: string; url: string } | undefined;
      withAgentLock(stored.dir, () => {
        peer = pinA2aPeer(stored.dir, stored.trust as TrustStoreData, raw);
      });
      print({ pinned: { actor: peer?.actor, url: peer?.url } });
      return 0;
    }
    case "verify-ledger": {
      const stored = await readAgent(root, need(o, "name"));
      const ledger = new FileLedger(join(stored.dir, "ledger.jsonl"));
      const check = verifyLedger(ledger.entries());
      print(check);
      return check.ok ? 0 : 1;
    }
    case "governance": {
      // Resource-governance metadata; with --name, audit that agent's directory against it.
      const name = opt(o, "name");
      let audit: ReturnType<typeof auditAgentDirectory> | undefined;
      if (name) {
        const stored = await readAgent(root, name);
        audit = auditAgentDirectory(stored.dir, {
          owner: stored.identity.party,
          ...(stored.identity.operator ? { operator: stored.identity.operator } : {}),
        });
      }
      const manifest = governanceManifest(audit);
      const out = opt(o, "out");
      if (out) {
        mkdirSync(resolve(out, ".."), { recursive: true });
        writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
        print({
          written: out,
          ...(audit ? { ok: audit.ok, unregistered: audit.unregistered } : {}),
        });
      } else print(manifest);
      return audit && !audit.ok ? 2 : 0;
    }
    case "propose-meeting": {
      const a = await openAgent(root, need(o, "name"), now);
      try {
        const terms = buildMeetingTerms({
          calendar: a.calendar,
          title: opt(o, "title") ?? "Synthetic test meeting",
          durationMinutes: Number.parseInt(opt(o, "duration") ?? "30", 10),
          window: { start: need(o, "window-start"), end: need(o, "window-end") },
          now: now().toISOString(),
        });
        if (terms.candidates.length === 0)
          throw new Error("no free slot of that duration in the window");
        const step = await a.rt.startNegotiation({
          peer: { actor: need(o, "peer-actor"), party: need(o, "peer-party") },
          operation: SCHEDULE_OP,
          terms: terms as never,
          models: [MEETING_MODEL],
        });
        const items = await prepareOutbound(
          a.rt,
          step.outbound,
          a.email ? { selfAddress: a.email } : {},
          a.threads,
          now(),
        );
        const files = await writeAndHandOff(a, need(o, "out"), items);
        print({ step: summariseStep(step), files, notice: NOT_SENT_NOTICE });
      } finally {
        a.close();
      }
      return 0;
    }
    case "process": {
      const a = await openAgent(root, need(o, "name"), now);
      try {
        const input = need(o, "input");
        const format = need(o, "format") as InputFormat;
        if (!["eml", "gmail-json", "envelope"].includes(format))
          throw new Error("--format must be eml, gmail-json or envelope");
        const data = input === "-" ? await (io.stdin ?? readStdin)() : readFileSync(input);
        if (data.length > 40 * 1024 * 1024) throw new Error("input exceeds 40 MiB");
        const recovered = await flushPending(a, join(need(o, "out"), "recovered"), now);
        const report = await processInput(
          a.rt,
          { format, data },
          { ...(a.email ? { selfAddress: a.email } : {}), strictParity: !o["lenient-parity"] },
          a.threads,
          now(),
        );
        const files = await writeAndHandOff(a, need(o, "out"), report.outbound);
        print({
          ...reportWithoutRaw(report),
          files,
          ...(recovered.length > 0 ? { recovered } : {}),
        });
        return report.step?.disposition === "rejected" ||
          (report.input && report.input.bindingOutcome !== "ok")
          ? 2
          : 0;
      } finally {
        a.close();
      }
    }
    case "approve": {
      // Convenience for a local operator who IS the owner: signs (owner key from --owner-dir or
      // a colocated compatibility key) and submits in one process. With separate custody,
      // prefer `sign-approval` on the owner's side and `submit_approval` on the service.
      const name = need(o, "name");
      const stored = await readAgent(root, name);
      const owner = await readOwnerKey(root, name, opt(o, "owner-dir"));
      const a = await openAgent(root, name, now);
      try {
        const digest = need(o, "action");
        const pending = a.rt.pendingApprovals().find((p) => p.actionDigest === digest);
        if (!pending)
          throw new Error(
            "no pending action with that digest (approvals bind to one exact action)",
          );
        const approval = await signApproval(owner.key, {
          type: "OwnerApproval",
          id: newUrn(),
          issuer: stored.identity.party,
          actor: stored.identity.actor,
          actionDigest: digest,
          conversation: pending.conversation,
          decision: o.deny ? "deny" : "approve",
          issuedAt: now().toISOString(),
          validUntil: new Date(now().getTime() + 3_600_000).toISOString(),
          note: "synthetic owner decision via CLI",
        });
        const step = await a.rt.submitApproval(approval);
        const items = await prepareOutbound(
          a.rt,
          step.outbound,
          a.email ? { selfAddress: a.email } : {},
          a.threads,
          now(),
        );
        print({
          step: summariseStep(step),
          files: await writeAndHandOff(a, need(o, "out"), items),
          intent: pending.intent,
          intentDigest: digestOf(pending.intent),
        });
      } finally {
        a.close();
      }
      return 0;
    }
    case "reconcile":
    case "recover": {
      const a = await openAgent(root, need(o, "name"), now);
      try {
        const files = await flushPending(a, need(o, "out"), now);
        print({
          recovered: files,
          effects: a.rt
            .effectStates()
            .map((e) => ({ key: e.key, status: e.status, conclusion: e.conclusion })),
        });
      } finally {
        a.close();
      }
      return 0;
    }
    case "configure-service": {
      // Local, reviewed operator configuration: the ONLY place a service endpoint comes from.
      const stored = await readAgent(root, need(o, "name"));
      const serviceId = need(o, "service");
      if (!REGISTRY.some((s) => s.id === serviceId))
        throw new Error(`unsupported service ${serviceId}`);
      const path = join(stored.dir, "services.json");
      withAgentLock(stored.dir, () => {
        const current = existsSync(path)
          ? (JSON.parse(readFileSync(path, "utf8")) as Record<string, string>)
          : {};
        writeFileSync(
          path,
          JSON.stringify(
            { ...current, [serviceId]: validateApiBase(need(o, "api-base")) },
            null,
            2,
          ),
        );
      });
      print({ configured: serviceId, apiBase: validateApiBase(need(o, "api-base")) });
      return 0;
    }
    case "remember-link": {
      const a = await openAgent(root, need(o, "name"), now);
      try {
        const input = need(o, "input");
        const data = input === "-" ? await (io.stdin ?? readStdin)() : readFileSync(input);
        const format = opt(o, "format") ?? "eml";
        const raw =
          format === "gmail-json" ? rawFromGmailMessage(JSON.parse(data.toString())) : data;
        print(a.scheduler.ingestEmail(raw));
      } finally {
        a.close();
      }
      return 0;
    }
    case "associations": {
      const a = await openAgent(root, need(o, "name"), now);
      try {
        print(a.associations.list().map((x) => ({ ...x, digest: associationDigest(x) })));
      } finally {
        a.close();
      }
      return 0;
    }
    case "confirm-association": {
      // Owner-signed promotion (owner key from --owner-dir or a colocated compatibility key).
      const name = need(o, "name");
      const stored = await readAgent(root, name);
      const owner = await readOwnerKey(root, name, opt(o, "owner-dir"));
      const a = await openAgent(root, name, now);
      try {
        const assoc = a.associations.get(need(o, "id"));
        if (!assoc) throw new Error("unknown association");
        const approval = await signApproval(owner.key, {
          type: "OwnerApproval",
          id: newUrn(),
          issuer: stored.identity.party,
          actor: stored.identity.actor,
          actionDigest: associationDigest(assoc),
          conversation: assoc.id,
          decision: o.deny ? "deny" : "approve",
          issuedAt: now().toISOString(),
          validUntil: new Date(now().getTime() + 3_600_000).toISOString(),
          note: "synthetic owner decision via CLI",
        });
        const next = await a.scheduler.confirm(assoc.id, approval);
        print({ id: next.id, status: next.status, validUntil: next.validUntil });
      } finally {
        a.close();
      }
      return 0;
    }
    case "book": {
      const a = await openAgent(root, need(o, "name"), now);
      try {
        const outcome = await a.scheduler.book({
          requestId: need(o, "request-id"),
          contact: need(o, "contact"),
          window: { start: need(o, "window-start"), end: need(o, "window-end") },
          durationMinutes: Number.parseInt(opt(o, "duration") ?? "30", 10),
        });
        print(outcome);
        return outcome.status === "booked" ? 0 : outcome.status === "uncertain" ? 3 : 2;
      } finally {
        a.close();
      }
    }
    case "revoke-mandate": {
      const a = await openAgent(root, need(o, "name"), now);
      try {
        print({
          ...(await a.rt.revokeMandate()),
          note: "persisted; a re-issued mandate with a higher version is needed to act again",
        });
      } finally {
        a.close();
      }
      return 0;
    }
    case "serve":
      return serve(
        root,
        need(o, "name"),
        need(o, "spool"),
        Number.parseInt(opt(o, "interval-ms") ?? "2000", 10),
        Boolean(o.once),
        now,
        io,
        !o["lenient-parity"],
      );
    case "mcp": {
      // Local MCP server over stdio: stdout is reserved for MCP messages from here on.
      const { runMcpServer } = await import("./mcp/server.js");
      const auto = Boolean(o["a2a-auto-dispatch"] || o["auto-dispatch"]);
      const code = await runMcpServer({
        root,
        name: need(o, "name"),
        now,
        ...(o.a2a ? { a2a: { autoDispatch: auto } } : {}),
        ...(o.public ? { public: { autoDispatch: auto } } : {}),
      });
      // The runtime is closed and the lock released. A blocking read on a FIFO stdin cannot
      // be cancelled, so end the process explicitly once stderr has drained.
      if (invokedDirectly) await new Promise<void>((r) => process.stderr.write("", () => r()));
      if (invokedDirectly) process.exit(code);
      return code;
    }
    case "demo": {
      const { runDemo } = await import("./demo/run.js");
      const out = opt(o, "out") ?? "reports/pilot-demo-report.json";
      const only = opt(o, "only")
        ?.split(",")
        .map((s) => s.trim());
      const policy = harnessPolicyEngine(o);
      const report = await runDemo({ ...(only ? { only } : {}), policy });
      mkdirSync(resolve(out, ".."), { recursive: true });
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
      print({ written: out, summary: report.summary });
      return report.summary.failed === 0 ? 0 : 1;
    }
    default:
      io.stdout(`${USAGE}\n`);
      return command ? 64 : 0;
  }
}

async function readStdin(): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += (chunk as Buffer).length;
    if (size > 40 * 1024 * 1024) throw new Error("stdin exceeds 40 MiB");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/**
 * Long-running local service: poll `<spool>/in` for provider-delivered files, process each
 * deterministically, write reviewed outbound items under `<spool>/out/<input>/`, and move
 * the input to `done/` or `rejected/`. No provider credentials; a supervisor process
 * drops files in and picks results up.
 */
async function serve(
  root: string,
  name: string,
  spool: string,
  intervalMs: number,
  once: boolean,
  now: () => Date,
  io: { stdout: (s: string) => void },
  strictParity: boolean,
): Promise<number> {
  for (const sub of ["in", "out", "done", "rejected"])
    mkdirSync(join(spool, sub), { recursive: true });
  const a = await openAgent(root, name, now);
  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const recovered = await flushPending(a, join(spool, "out", `recovered-${Date.now()}`), now);
    // Readiness line for supervised startup (one JSON object per line).
    io.stdout(
      `${JSON.stringify({
        ready: true,
        name,
        pid: process.pid,
        recovered: recovered.length,
        ...(a.recoveredStaleLockPid ? { recoveredStaleLockFromPid: a.recoveredStaleLockPid } : {}),
      })}\n`,
    );
    do {
      const files = readdirSync(join(spool, "in"))
        .filter((f) => formatFromName(f))
        .sort()
        .slice(0, 50);
      for (const f of files) {
        const path = join(spool, "in", f);
        const format = formatFromName(f) as InputFormat;
        let report: ProcessReport | undefined;
        let ok = false;
        try {
          if (statSync(path).size > 40 * 1024 * 1024) throw new Error("input too large");
          report = await processInput(
            a.rt,
            { format, data: readFileSync(path) },
            { ...(a.email ? { selfAddress: a.email } : {}), strictParity },
            a.threads,
            now(),
          );
          const outDir = join(spool, "out", basename(f));
          mkdirSync(outDir, { recursive: true });
          await writeAndHandOff(a, outDir, report.outbound);
          writeFileSync(
            join(outDir, "report.json"),
            JSON.stringify(reportWithoutRaw(report), null, 2),
          );
          ok = report.input?.bindingOutcome === "ok" && report.step?.disposition !== "rejected";
        } catch (error) {
          io.stdout(`${JSON.stringify({ file: f, error: (error as Error).message })}\n`);
        }
        renameSync(path, join(spool, ok ? "done" : "rejected", f));
        io.stdout(
          `${JSON.stringify({
            file: f,
            disposition: report?.step?.disposition ?? report?.input?.bindingOutcome ?? "error",
            outbound: report?.outbound.length ?? 0,
          })}\n`,
        );
        if (stopping) break;
      }
      if (!once && !stopping) {
        await new Promise<void>((r) => {
          wake = r;
          setTimeout(r, Math.max(100, intervalMs));
        });
      }
    } while (!once && !stopping);
  } finally {
    a.close();
  }
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  existsSync(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: Error) => {
      process.stderr.write(`awp-pilot: ${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
