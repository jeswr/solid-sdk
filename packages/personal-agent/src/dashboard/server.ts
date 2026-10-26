/**
 * The owner dashboard's local web server (loopback only).
 *
 * Localhost is not authentication. Protections:
 *  - binds 127.0.0.1 only; every request's Host must be 127.0.0.1:PORT or localhost:PORT
 *    (DNS-rebinding guard); cross-origin requests are refused (Origin / Sec-Fetch-Site), and no
 *    CORS headers are ever sent;
 *  - a ONE-TIME bootstrap code (printed to the owner's terminal, carried in the URL fragment so it
 *    never reaches server logs or a Referer) is exchanged for a session cookie (HttpOnly,
 *    SameSite=Strict); the page removes the fragment from history immediately;
 *  - every write needs the session's CSRF token in a header, a JSON body (≤ 256 KiB) and the
 *    settings revision it was based on (conflicts are refused, not merged);
 *  - strict Content-Security-Policy (self only, no inline script/style, no eval), nosniff,
 *    no-referrer, frame-ancestors none; only an allowlist of static files is served;
 *  - DTOs are allowlisted and validated; the browser never chooses a file path, an inference URL
 *    or a command. There is no route that sends a message, books a real appointment, writes to a
 *    provider account or changes a provider's permissions. The only provider calls are the
 *    read-only calendar availability reads of the deterministic actions, and only when the
 *    OPERATOR started the server with provider access (`--provider-config`); action execution
 *    (local agent state) is not available here at all.
 * The TypeSafe key (if any) comes from the server's environment and is never returned.
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { availabilityPermissions } from "../actions/calendar/availability.js";
import { credentialState } from "../actions/capabilities.js";
import type { ActionsEnv } from "../actions/env.js";
import { createActionRegistry } from "../actions/index.js";
import type { ProviderEnvironment } from "../actions/providers/common.js";
import type { ActionContext } from "../actions/types.js";
import { iso } from "../pilot/core/schema.js";
import {
  DEFAULT_THRESHOLDS,
  PRIMARY_DESCRIPTIONS,
  sampleSchema,
  URGENCY_DESCRIPTIONS,
} from "../triage/taxonomy.js";
import { triageSample } from "../triage/triage.js";
import { TYPESAFE_ENDPOINT, typeSafeFromEnv } from "../triage/typesafe.js";
import { summariseAgent } from "./agents.js";
import {
  CAPABILITIES,
  CONNECTION_STATES,
  capabilityMatrix,
  connectionStatus,
  effectiveCapability,
  sampleTriagePermission,
} from "./assess.js";
import {
  appliedMatches,
  applyToAgent,
  evaluateCalendars,
  KIND_LABEL,
  previewScheduling,
} from "./calendars.js";
import {
  availabilitySchema,
  type Connection,
  calendarSchema,
  channelGroup,
  DENY_ALL,
  MAX_CONNECTIONS,
  restrictionsSchema,
  type Settings,
} from "./model.js";
import { setupGuide } from "./setup-guide.js";
import { RevisionConflictError, SettingsStore } from "./store.js";

export const DEFAULT_PORT = 4318;

/** Local reply preparation: included, draft allowed by the owner, and `draft` in the policy. */
function sampleDraftAllowed(c: Connection, policy: Settings["workflowPolicy"]): boolean {
  return (
    c.restrictions.agentEnabled &&
    c.restrictions.draft &&
    Boolean(policy?.defaultAllowed.includes("draft"))
  );
}
const SESSION_COOKIE = "awp_dashboard";
const SESSION_TTL_MS = 12 * 3_600_000;
const CODE_TTL_MS = 10 * 60_000;
const MAX_SESSIONS = 20;
const MAX_FAILED_CODES = 10;
const BODY_LIMIT = "256kb";

export interface DashboardOptions {
  stateDir: string;
  agentsDir: string;
  port: number;
  /**
   * The REAL clock: connection-status freshness, change history and other audit times (injectable
   * for deterministic tests). Default: the system clock.
   */
  now?: () => Date;
  /**
   * The SCHEDULING clock for previews only (a fixed synthetic demo clock may be supplied, e.g.
   * `serve --now`). It never dates history or judges how fresh an observation is.
   */
  schedulingNow?: () => Date;
  /** Server environment for the optional TypeSafe adapter (TYPESAFE_API_KEY, TYPESAFE_MODEL). */
  env?: NodeJS.ProcessEnv;
  /** Injected HTTP client for the hosted classifier (tests). */
  fetchImpl?: typeof fetch;
  /**
   * Provider access for the deterministic actions (operator configuration: live helper config,
   * synthetic fixtures, or none). Never chosen by the browser.
   */
  actions?: { providers: ProviderEnvironment; configuredConnections: readonly string[] };
  log?: (line: string) => void;
}

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));
const STATIC: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/assets/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/assets/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
  "/assets/icon.svg": { file: "icon.svg", type: "image/svg+xml" },
};

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self'",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
].join("; ");

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

function cookieValue(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return undefined;
}

// ------------------------------------------------------------------ request DTOs

const revisionBody = z.strictObject({ baseRevision: z.number().int().min(0) });
const manualConnection = z.strictObject({
  label: z.string().trim().min(1).max(120),
  channel: z.string().regex(/^[a-z0-9_]{1,40}$/),
  provider: z.string().trim().max(60),
  organisation: z.string().trim().max(120),
  identifiers: z.array(z.string().trim().min(1).max(200)).max(10),
  notes: z.string().max(1000),
  target: z.string().trim().max(80).optional(),
});
const connectionChanges = z.strictObject({
  restrictions: restrictionsSchema.optional(),
  notes: z.string().max(1000).optional(),
  target: z.string().trim().max(80).optional(),
  // Descriptive fields: only for records you added (inventory records follow the inventory).
  label: z.string().trim().min(1).max(120).optional(),
  channel: z
    .string()
    .regex(/^[a-z0-9_]{1,40}$/)
    .optional(),
  provider: z.string().trim().max(60).optional(),
  organisation: z.string().trim().max(120).optional(),
  identifiers: z.array(z.string().trim().min(1).max(200)).max(10).optional(),
});
const calendarsBody = z.strictObject({
  calendars: z.array(calendarSchema).max(50),
  availability: availabilitySchema,
});
const previewBody = z.strictObject({
  window: z.strictObject({ start: iso, end: iso }),
  durationMinutes: z.number().int().min(15).max(240),
  /** Unsaved calendar settings to preview (optional). */
  draft: calendarsBody.optional(),
});
const classifyBody = z.strictObject({
  sample: sampleSchema,
  /** The owner confirms the sample is made up (no real messages in this phase). */
  synthetic: z.literal(true),
  accountId: z.string().max(64).optional(),
  useHosted: z.boolean(),
  /** Explicit consent to send THIS sample to the hosted provider. */
  consent: z.boolean(),
});

/** Structural checks the schemas cannot express (unique ids, known references). */
function checkCalendars(settings: Settings, body: z.infer<typeof calendarsBody>): void {
  const ids = new Set<string>();
  for (const c of body.calendars) {
    if (ids.has(c.id)) throw new HttpError(400, `two calendars share the id “${c.id}”`);
    ids.add(c.id);
    if (c.kind === "agent-synthetic" && (!c.agent || !settings.managedAgents.includes(c.agent)))
      throw new HttpError(400, `“${c.label}” must be linked to a managed agent`);
    if (c.kind !== "agent-synthetic" && c.agent)
      throw new HttpError(400, `only an agent's own calendar is linked to an agent`);
    if (c.kind !== "local-synthetic" && c.busy.length > 0)
      throw new HttpError(400, `busy periods can only be kept for synthetic calendars kept here`);
    if (c.connectionId && !settings.connections.some((x) => x.id === c.connectionId))
      throw new HttpError(400, `“${c.label}” refers to an unknown account`);
  }
  for (const id of body.availability.authoritative)
    if (!ids.has(id)) throw new HttpError(400, "an availability calendar does not exist");
  if (body.availability.bookingTarget && !ids.has(body.availability.bookingTarget))
    throw new HttpError(400, "the booking calendar does not exist");
}

function slug(label: string): string {
  const base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "account"}-${randomBytes(3).toString("hex")}`;
}

// ------------------------------------------------------------------ the app

export interface DashboardApp {
  app: express.Express;
  store: SettingsStore;
  /** Issue a fresh single-use bootstrap code (the CLI prints it as a URL fragment). */
  issueBootstrapCode(): string;
  hostedConfigured: boolean;
}

export function createDashboardApp(opts: DashboardOptions): DashboardApp {
  const now = opts.now ?? (() => new Date());
  const schedulingNow = opts.schedulingNow ?? now;
  const syntheticClock = opts.schedulingNow !== undefined;
  const log = opts.log ?? (() => undefined);
  const store = new SettingsStore(opts.stateDir, now);
  store.init();
  const hosted = typeSafeFromEnv(opts.env ?? {}, opts.fetchImpl ?? fetch);
  if (hosted.problem) log(`dashboard: hosted triage not configured: ${hosted.problem}`);
  const allowedHosts = new Set([`127.0.0.1:${opts.port}`, `localhost:${opts.port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));
  const sessions = new Map<string, { csrf: string; expiresAt: number }>();
  let bootstrap: { code: string; expiresAt: number } | undefined;
  let failedCodes = 0;
  const assets = new Map<string, Buffer>();
  for (const [route, a] of Object.entries(STATIC)) {
    const path = join(PUBLIC_DIR, a.file);
    if (existsSync(path)) assets.set(route, readFileSync(path));
  }

  const app = express();
  app.disable("x-powered-by");
  app.disable("etag");
  app.set("trust proxy", false);

  // 1. Host (DNS rebinding) and cross-origin guards, before anything else.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Content-Security-Policy", CSP);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=()");
    if (!allowedHosts.has(req.headers.host ?? "")) {
      res.status(421).type("text/plain").send("unexpected Host");
      return;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) {
      res.status(403).type("text/plain").send("cross-origin request refused");
      return;
    }
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin" && site !== "none") {
      res.status(403).type("text/plain").send("cross-site request refused");
      return;
    }
    if (!["GET", "HEAD"].includes(req.method) && origin === undefined) {
      res.status(403).type("text/plain").send("writes need an Origin header");
      return;
    }
    next();
  });

  // 2. Static allowlist (nothing else from disk is ever served).
  app.get(Object.keys(STATIC), (req: Request, res: Response) => {
    const body = assets.get(req.path);
    const meta = STATIC[req.path];
    if (!body || !meta) {
      res.status(404).type("text/plain").send("not found");
      return;
    }
    res.setHeader("Cache-Control", "no-cache");
    res.type(meta.type).send(body);
  });

  // 3. API: JSON only, bounded, no-store.
  const api = express.Router();
  api.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json")) {
      res.status(415).json({ error: "send JSON (application/json)" });
      return;
    }
    next();
  });
  api.use(express.json({ limit: BODY_LIMIT, strict: true, type: "application/json" }));

  // Session bootstrap: the ONLY unauthenticated API call.
  api.post("/session", (req: Request, res: Response) => {
    const code = z.strictObject({ code: z.string().min(16).max(128) }).safeParse(req.body);
    const valid =
      code.success &&
      bootstrap !== undefined &&
      bootstrap.expiresAt > Date.now() &&
      failedCodes < MAX_FAILED_CODES &&
      safeEqual(code.data.code, bootstrap.code);
    if (!valid) {
      failedCodes++;
      res.status(401).json({
        error:
          "This sign-in link is not valid any more. Press Enter in the dashboard's terminal for a new one.",
      });
      return;
    }
    bootstrap = undefined; // single use
    failedCodes = 0;
    const id = randomBytes(32).toString("base64url");
    const csrf = randomBytes(32).toString("base64url");
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
    sessions.set(id, { csrf, expiresAt: Date.now() + SESSION_TTL_MS });
    res.setHeader(
      "Set-Cookie",
      `${SESSION_COOKIE}=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`,
    );
    res.json({ csrf });
  });

  // Everything else needs a session; writes also need the CSRF token.
  api.use((req: Request, res: Response, next: NextFunction) => {
    const id = cookieValue(req, SESSION_COOKIE);
    const session = id ? sessions.get(id) : undefined;
    if (!session || session.expiresAt < Date.now()) {
      if (id) sessions.delete(id);
      res
        .status(401)
        .json({ error: "Not signed in. Open the link printed in the dashboard's terminal." });
      return;
    }
    if (!["GET", "HEAD"].includes(req.method)) {
      const token = req.headers["x-csrf-token"];
      if (typeof token !== "string" || !safeEqual(token, session.csrf)) {
        res.status(403).json({ error: "missing or invalid CSRF token; reload the page" });
        return;
      }
    }
    res.locals.csrf = session.csrf;
    next();
  });

  const settings = () => store.read();
  const writeWith = (
    baseRevision: number,
    action: string,
    summary: string | (() => string),
    change: (d: Settings) => void,
  ) => store.update(baseRevision, "owner (dashboard)", action, summary, change);
  const statusOf = (c: Connection) => connectionStatus(c, now());

  api.get("/session", (_req: Request, res: Response) => {
    res.json({ csrf: res.locals.csrf });
  });

  api.get("/overview", (_req: Request, res: Response) => {
    const s = settings();
    const byState: Record<string, number> = {};
    const byGroup: Record<string, number> = {};
    let enabled = 0;
    let stale = 0;
    for (const c of s.connections) {
      const st = statusOf(c);
      byState[st.state] = (byState[st.state] ?? 0) + 1;
      byGroup[channelGroup(c.channel)] = (byGroup[channelGroup(c.channel)] ?? 0) + 1;
      if (c.restrictions.agentEnabled) enabled++;
      if (st.stale) stale++;
    }
    const ev = evaluateCalendars(s, opts.agentsDir);
    res.json({
      revision: s.revision,
      inventory: s.inventory
        ? { observedAt: s.inventory.observedAt, registryUpdated: s.inventory.registryUpdated }
        : null,
      connections: { total: s.connections.length, byState, byGroup, enabled, stale },
      states: CONNECTION_STATES,
      calendars: { total: s.calendars.length, status: ev.status, reasons: ev.reasons },
      agents: s.managedAgents.map((n) => {
        const a = summariseAgent(opts.agentsDir, n);
        return { name: n, found: a.found, running: a.running, availability: a.availability };
      }),
      triage: { hostedConfigured: hosted.configured, hostedEnabled: s.triage.hostedEnabled },
      policyImported: s.workflowPolicy !== null,
      recent: s.history.slice(-5).reverse(),
    });
  });

  api.get("/connections", (_req: Request, res: Response) => {
    const s = settings();
    res.json({
      revision: s.revision,
      states: CONNECTION_STATES,
      inventory: s.inventory,
      connections: s.connections.map((c) => ({
        ...c,
        group: channelGroup(c.channel),
        status: statusOf(c),
        setup: setupGuide(c),
      })),
    });
  });

  api.post("/connections", (req: Request, res: Response) => {
    const body = revisionBody.extend({ record: manualConnection }).parse(req.body);
    const at = now().toISOString();
    const r = body.record;
    const next = writeWith(body.baseRevision, "Added an account record", r.label, (d) => {
      if (d.connections.length >= MAX_CONNECTIONS)
        throw new HttpError(400, `at most ${MAX_CONNECTIONS} account records`);
      d.connections.push({
        id: slug(r.label),
        label: r.label,
        channel: r.channel,
        provider: r.provider,
        organisation: r.organisation,
        identifiers: r.identifiers,
        origin: "manual",
        evidence: [],
        conflicts: [],
        localConnector: { state: "setup-required", ...(r.target ? { target: r.target } : {}) },
        restrictions: { ...DENY_ALL },
        notes: r.notes,
        updatedAt: at,
        updatedBy: "owner (dashboard)",
      });
    });
    res.status(201).json({ revision: next.revision, id: next.connections.at(-1)?.id });
  });

  api.put("/connections/:id", (req: Request, res: Response) => {
    const body = revisionBody.extend({ changes: connectionChanges }).parse(req.body);
    const id = String(req.params.id);
    const ch = body.changes;
    const described = ["label", "channel", "provider", "organisation", "identifiers"].filter(
      (k) => k in ch,
    );
    let label = id;
    const next = writeWith(body.baseRevision, "Changed an account", id, (d) => {
      const c = d.connections.find((x) => x.id === id);
      if (!c) throw new HttpError(404, "no such account");
      label = c.label;
      if (c.origin === "inventory" && described.length > 0)
        throw new HttpError(
          400,
          "Imported accounts follow the inventory; change them there and import again.",
        );
      if (ch.restrictions) c.restrictions = ch.restrictions;
      if (ch.notes !== undefined) c.notes = ch.notes;
      if (ch.target !== undefined)
        c.localConnector = {
          state: c.origin === "inventory" && !ch.target ? "none" : "setup-required",
          ...(ch.target ? { target: ch.target } : {}),
        };
      if (ch.label !== undefined) c.label = ch.label;
      if (ch.channel !== undefined) c.channel = ch.channel;
      if (ch.provider !== undefined) c.provider = ch.provider;
      if (ch.organisation !== undefined) c.organisation = ch.organisation;
      if (ch.identifiers !== undefined) c.identifiers = ch.identifiers;
      c.updatedAt = now().toISOString();
      c.updatedBy = "owner (dashboard)";
    });
    const c = next.connections.find((x) => x.id === id) as Connection;
    res.json({ revision: next.revision, connection: { ...c, status: statusOf(c) }, label });
  });

  api.delete("/connections/:id", (req: Request, res: Response) => {
    const body = revisionBody.parse(req.body);
    const id = String(req.params.id);
    const next = writeWith(body.baseRevision, "Removed an account record", id, (d) => {
      const c = d.connections.find((x) => x.id === id);
      if (!c) throw new HttpError(404, "no such account");
      if (c.origin === "inventory")
        throw new HttpError(
          400,
          "Imported accounts cannot be removed here. Exclude the account from the agent instead.",
        );
      if (d.calendars.some((k) => k.connectionId === id))
        throw new HttpError(400, "A calendar refers to this account; change the calendar first.");
      d.connections = d.connections.filter((x) => x.id !== id);
    });
    res.json({ revision: next.revision });
  });

  api.get("/calendars", (_req: Request, res: Response) => {
    const s = settings();
    res.json({
      revision: s.revision,
      calendars: s.calendars,
      availability: s.availability,
      evaluation: evaluateCalendars(s, opts.agentsDir),
      managedAgents: s.managedAgents.map((n) => {
        const a = summariseAgent(opts.agentsDir, n);
        return {
          name: n,
          found: a.found,
          running: a.running,
          availability: a.availability,
          // Whether the applied file has the content the SAVED settings would apply now.
          matchesSaved: a.found ? appliedMatches(s, opts.agentsDir, n) : null,
          holds: a.holds,
        };
      }),
      kinds: KIND_LABEL,
      accounts: s.connections
        .filter((c) => channelGroup(c.channel) !== "chat")
        .map((c) => ({ id: c.id, label: c.label })),
      clock: schedulingNow().toISOString(),
      // The preview clock is shown as such: a synthetic demo clock is not the real time.
      schedulingClock: { now: schedulingNow().toISOString(), synthetic: syntheticClock },
    });
  });

  api.put("/calendars", (req: Request, res: Response) => {
    const body = revisionBody.extend(calendarsBody.shape).parse(req.body);
    const next = writeWith(
      body.baseRevision,
      "Changed calendar settings",
      `${body.calendars.length} calendars; ${body.availability.authoritative.length} count for availability`,
      (d) => {
        checkCalendars(d, body);
        d.calendars = body.calendars;
        d.availability = body.availability;
      },
    );
    res.json({ revision: next.revision, evaluation: evaluateCalendars(next, opts.agentsDir) });
  });

  api.post("/calendars/preview", (req: Request, res: Response) => {
    const body = previewBody.parse(req.body);
    let s = settings();
    if (body.draft) {
      checkCalendars(s, body.draft);
      s = { ...s, calendars: body.draft.calendars, availability: body.draft.availability };
    }
    if (Date.parse(body.window.end) - Date.parse(body.window.start) > 14 * 86_400_000)
      throw new HttpError(400, "preview at most 14 days");
    res.json(
      previewScheduling(s, opts.agentsDir, {
        window: body.window,
        durationMinutes: body.durationMinutes,
        now: schedulingNow().toISOString(),
      }),
    );
  });

  api.post("/calendars/apply", (req: Request, res: Response) => {
    const body = revisionBody
      .extend({ agent: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/) })
      .parse(req.body);
    // The overlay is written INSIDE the settings update: under the settings lock and only after
    // the revision check, so a stale revision never installs an overlay. If the process stops
    // between writing the overlay and the settings (history), the overlay stays applied without
    // its history entry; applying again is idempotent.
    let result: ReturnType<typeof applyToAgent> | undefined;
    const next = writeWith(
      body.baseRevision,
      "Applied availability to an agent",
      () =>
        `${body.agent}: ${result?.file.blocked ? `blocked (${result.file.blocked.reason})` : "ready"}`,
      (d) => {
        try {
          result = applyToAgent(d, opts.agentsDir, body.agent, now().toISOString());
        } catch (error) {
          // applyToAgent refuses unmanaged, missing or non-personal agents with a plain message;
          // anything else (e.g. a filesystem error naming a path) stays a sanitised 500.
          const message = (error as Error).message;
          if (/^(that agent |availability applies )/.test(message))
            throw new HttpError(400, message);
          throw error;
        }
      },
    );
    if (!result) throw new Error("apply did not run");
    res.json({
      revision: next.revision,
      agent: body.agent,
      applied: {
        revision: result.file.revision,
        blocked: result.file.blocked?.reason ?? null,
        busyPeriods: result.file.busy.length,
        sources: result.file.sources,
      },
      running: result.running,
      takesEffect: result.running
        ? "The agent is running; it reads availability when it starts, so this applies at its next start."
        : "Applies the next time the agent starts.",
    });
  });

  api.get("/permissions", (_req: Request, res: Response) => {
    const s = settings();
    const ev = evaluateCalendars(s, opts.agentsDir);
    res.json({
      revision: s.revision,
      capabilities: CAPABILITIES,
      matrix: capabilityMatrix(s, hosted.configured),
      policy: s.workflowPolicy,
      calendars: ev.sources,
      boundaries: [
        {
          title: "Every outgoing message needs your review",
          detail:
            "Nothing is sent without your review of the exact message. This dashboard has no send control.",
        },
        {
          title: "Synthetic only",
          detail:
            "The agents here exchange synthetic messages and book synthetic calendar holds. No real mail, appointment or payment.",
        },
        {
          title: "No provider changes from here",
          detail:
            "This dashboard cannot sign in to providers, widen their permissions, or grant the agent new signed permissions.",
        },
        {
          title: "Ask when uncertain",
          detail: s.workflowPolicy
            ? `Your rules ask you when the agent is unsure about: ${s.workflowPolicy.askWhenUncertain.map((x) => x.replaceAll("_", " ")).join(", ")}.`
            : "Import your communication rules to see them here.",
        },
      ],
      agents: s.managedAgents.map((n) => summariseAgent(opts.agentsDir, n)),
    });
  });

  api.get("/triage", (_req: Request, res: Response) => {
    const s = settings();
    res.json({
      revision: s.revision,
      hosted: {
        provider: "TypeSafe",
        endpoint: TYPESAFE_ENDPOINT,
        configured: hosted.configured,
        model: hosted.model,
        enabled: s.triage.hostedEnabled,
        ...(hosted.problem ? { problem: hosted.problem } : {}),
      },
      thresholds: DEFAULT_THRESHOLDS,
      taxonomy: { primary: PRIMARY_DESCRIPTIONS, urgency: URGENCY_DESCRIPTIONS },
      ownerTaxonomy: s.workflowPolicy?.taxonomy ?? null,
      accounts: s.connections.map((c) => ({
        id: c.id,
        label: c.label,
        hosted: effectiveCapability(c, "hostedTriage", {
          policy: s.workflowPolicy,
          hostedEnabled: s.triage.hostedEnabled,
          hostedKeyConfigured: hosted.configured,
        }),
      })),
    });
  });

  api.put("/triage", (req: Request, res: Response) => {
    const body = revisionBody.extend({ hostedEnabled: z.boolean() }).parse(req.body);
    const next = writeWith(
      body.baseRevision,
      body.hostedEnabled ? "Turned hosted triage on" : "Turned hosted triage off",
      "TypeSafe triage for samples you explicitly confirm",
      (d) => {
        d.triage.hostedEnabled = body.hostedEnabled;
      },
    );
    res.json({ revision: next.revision, enabled: next.triage.hostedEnabled });
  });

  api.post("/triage/classify", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = classifyBody.parse(req.body);
      const s = settings();
      const account = body.accountId
        ? s.connections.find((c) => c.id === body.accountId)
        : undefined;
      if (body.accountId && !account) throw new HttpError(404, "no such account");
      // A sample linked to an account is triaged only if that account's restrictions and the
      // policy allow triage — for the local rules too. Unlinked samples are a synthetic sandbox.
      if (account) {
        const permission = sampleTriagePermission(account, s.workflowPolicy);
        if (!permission.allowed)
          throw new HttpError(
            403,
            `Triage is not allowed for “${account.label}”: ${permission.why}`,
          );
      }
      let decision: { allowed: boolean; why: string } = { allowed: false, why: "not requested" };
      if (body.useHosted) {
        decision = !hosted.classifier
          ? { allowed: false, why: "No TypeSafe key is configured on this machine." }
          : !s.triage.hostedEnabled
            ? { allowed: false, why: "Hosted triage is turned off." }
            : !body.consent
              ? { allowed: false, why: "You did not confirm sending this sample to TypeSafe." }
              : account
                ? (() => {
                    const e = effectiveCapability(account, "hostedTriage", {
                      policy: s.workflowPolicy,
                      hostedEnabled: s.triage.hostedEnabled,
                      hostedKeyConfigured: hosted.configured,
                    });
                    return { allowed: e.allowed, why: e.summary };
                  })()
                : {
                    allowed: true,
                    why: "Synthetic sandbox sample, sent with your confirmation.",
                  };
      }
      const result = await triageSample(
        body.sample,
        body.useHosted && hosted.classifier
          ? { classifier: hosted.classifier, allowed: decision.allowed, why: decision.why }
          : undefined,
      );
      if (body.useHosted && !hosted.classifier && result.route === "suggestion")
        result.hosted = { status: "not-allowed", detail: decision.why };
      res.json(result);
    } catch (error) {
      next(error);
    }
  });

  // ---------------------------------------------------------------- deterministic actions
  const actionRegistry = createActionRegistry();
  const actionProviders = opts.actions ?? {
    providers: {
      mode: "none" as const,
      fetch: (async () => {
        throw new Error("provider access is not configured");
      }) as typeof fetch,
    },
    configuredConnections: [],
  };
  const actionContext = (): ActionContext<ActionsEnv> => ({
    origin: "dashboard",
    now,
    schedulingNow,
    env: {
      settings: settings(),
      agentsDir: opts.agentsDir,
      stateDir: opts.stateDir,
      providers: actionProviders.providers,
      configuredConnections: actionProviders.configuredConnections,
    },
  });

  api.get("/actions", (_req: Request, res: Response) => {
    const ctx = actionContext();
    const s = ctx.env.settings;
    res.json({
      revision: s.revision,
      providerMode: actionProviders.providers.mode,
      schedulingClock: { now: schedulingNow().toISOString(), synthetic: syntheticClock },
      actions: actionRegistry.describe(ctx),
      permissions: {
        calendars: availabilityPermissions(ctx),
        accounts: s.connections.map((c) => ({
          id: c.id,
          label: c.label,
          included: c.restrictions.agentEnabled,
          draft: sampleDraftAllowed(c, s.workflowPolicy),
          triage: sampleTriagePermission(c, s.workflowPolicy).allowed,
          credential: credentialState(c, actionProviders),
        })),
      },
    });
  });

  api.post("/actions/:id/prepare", async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z.strictObject({ input: z.unknown() }).parse(req.body);
      const report = await actionRegistry.prepare(
        String(req.params.id),
        body.input ?? {},
        actionContext(),
      );
      // Execution is an operator step (CLI/MCP); the dashboard never executes.
      const { preparation: _p, ...shown } = report;
      res.json(
        report.preparation
          ? {
              ...shown,
              execution:
                "Prepared only. Execution is an operator step (awp-dashboard actions prepare/execute, or the actions MCP server).",
            }
          : shown,
      );
    } catch (error) {
      next(error);
    }
  });

  api.get("/history", (_req: Request, res: Response) => {
    const s = settings();
    res.json({ revision: s.revision, history: [...s.history].reverse() });
  });

  api.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "not found" });
  });
  app.use("/api", api);

  app.use((_req: Request, res: Response) => {
    res.status(404).type("text/plain").send("not found");
  });

  // Errors: short, plain messages; never stack traces, file paths or secrets.
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof RevisionConflictError) {
      res.status(409).json({ error: error.message, revision: error.current });
      return;
    }
    if (error instanceof HttpError) {
      res.status(error.status).json({ error: error.message });
      return;
    }
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: "Some values are not valid.",
        issues: error.issues.slice(0, 10).map((i) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      });
      return;
    }
    const e = error as { type?: string; status?: number };
    if (e.type === "entity.too.large") {
      res.status(413).json({ error: "request too large" });
      return;
    }
    if (e.type === "entity.parse.failed" || e.status === 400) {
      res.status(400).json({ error: "the request body is not valid JSON" });
      return;
    }
    const message = (error as Error).message ?? "error";
    log(`dashboard: request failed: ${message.slice(0, 200)}`);
    res.status(500).json({ error: "The dashboard could not complete that request." });
  });

  return {
    app,
    store,
    hostedConfigured: hosted.configured,
    issueBootstrapCode() {
      const code = randomBytes(32).toString("base64url");
      bootstrap = { code, expiresAt: Date.now() + CODE_TTL_MS };
      failedCodes = 0;
      return code;
    },
  };
}

/** Listen on 127.0.0.1 only. */
export function listenDashboard(d: DashboardApp, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = d.app.listen(port, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
    server.requestTimeout = 30_000;
    server.headersTimeout = 20_000;
  });
}
