// AUTHORED-BY Claude Opus 5.5
// Step 9: verification. Replays each learned read once with sample values, signed out and (when a
// session exists) signed in. Sets the session requirement and provenance counters, flags reads whose
// extraction finds nothing, and drops reads that fail both ways. Never replays a write.

import type { Operation } from "@jeswr/site-model";
import { applyExtraction } from "./extraction.js";
import type { Recorder } from "./recorder.js";
import { expandTemplate } from "./util.js";

export interface ReplayResponse {
  status: number;
  contentType?: string;
  body: string;
  location?: string;
}

/** Sends GET requests for verification; signed-in replays carry the profiling session. */
export interface Replayer {
  get(url: string, opts: { signedIn: boolean }): Promise<ReplayResponse>;
}

const ok = (r: ReplayResponse | undefined) => r !== undefined && r.status >= 200 && r.status < 300;

/** Values to replay an operation with: its examples, then defaults. Undefined when a required value is missing. */
export function sampleValues(op: Operation): Record<string, string> | undefined {
  const values: Record<string, string> = {};
  for (const p of op.inputs) {
    const v = p.example ?? p.default;
    if (v !== undefined) values[p.name] = v;
    else if (p.required) return undefined;
  }
  return values;
}

export interface VerifyOptions {
  replayer: Replayer;
  now: () => Date;
  /** True when the profiler holds a signed-in session. */
  haveSession: boolean;
}

export async function verifyOperations(
  ops: Operation[],
  options: VerifyOptions,
): Promise<{ operations: Operation[]; warnings: string[] }> {
  const warnings: string[] = [];
  const out: Operation[] = [];
  for (const op of ops) {
    if (op.effect !== "read" || op.request.method !== "GET") {
      out.push(op);
      continue;
    }
    const values = sampleValues(op);
    if (!values) {
      warnings.push(`verify: no sample values for ${op.label}; left unverified`);
      out.push(op);
      continue;
    }
    const url = expandTemplate(op.request.urlTemplate, values);
    const anon = await options.replayer.get(url, { signedIn: false }).catch(() => undefined);
    const auth =
      options.haveSession && !ok(anon)
        ? await options.replayer.get(url, { signedIn: true }).catch(() => undefined)
        : undefined;
    const good = ok(anon) ? anon : ok(auth) ? auth : undefined;
    const attempts = (op.provenance.attempts ?? 0) + 1;
    if (!good) {
      warnings.push(
        `verify: dropped ${op.label} (${url} answered ${anon?.status ?? "no response"}${auth ? ` / ${auth.status}` : ""})`,
      );
      continue;
    }
    const verified: Operation = {
      ...op,
      session: ok(anon) ? "none" : "signed-in",
      provenance: {
        ...op.provenance,
        attempts,
        successes: (op.provenance.successes ?? 0) + 1,
        lastVerified: options.now().toISOString(),
      },
    };
    if (op.extraction) {
      const items = applyExtraction(op.extraction, good.body, url);
      const filled = items.filter((i) => Object.keys(i).length > 0);
      if (filled.length === 0) {
        warnings.push(`verify: ${op.label} extraction found nothing on replay`);
        verified.provenance.confidence = Math.round(op.provenance.confidence * 50) / 100;
      }
    }
    out.push(verified);
  }
  return { operations: out, warnings };
}

/** The first candidate that answers 200 signed in and redirects or refuses signed out. */
export async function findProbeUrl(
  candidates: string[],
  replayer: Replayer,
): Promise<string | undefined> {
  for (const url of candidates) {
    const anon = await replayer.get(url, { signedIn: false }).catch(() => undefined);
    if (!anon || ok(anon)) continue;
    const refused =
      (anon.status >= 300 && anon.status < 400) || anon.status === 401 || anon.status === 403;
    if (!refused) continue;
    const auth = await replayer.get(url, { signedIn: true }).catch(() => undefined);
    if (ok(auth)) return url;
  }
  return undefined;
}

/** A Replayer over a Playwright context (signed in) and plain fetch (signed out), recording into the trace. */
export function playwrightReplayer(
  context: import("playwright").BrowserContext,
  recorder: Recorder,
  phase: "probe" | "verify",
): Replayer {
  return {
    async get(url, { signedIn }) {
      const prev = recorder.phase;
      recorder.phase = phase;
      try {
        let res: ReplayResponse;
        if (signedIn) {
          const r = await context.request.get(url, { maxRedirects: 0, failOnStatusCode: false });
          const headers = r.headers();
          res = { status: r.status(), body: await r.text().catch(() => "") };
          if (headers["content-type"]) res.contentType = headers["content-type"];
          if (headers.location) res.location = headers.location;
        } else {
          const r = await fetch(url, { redirect: "manual" });
          res = { status: r.status, body: await r.text().catch(() => "") };
          const ct = r.headers.get("content-type");
          if (ct) res.contentType = ct;
          const loc = r.headers.get("location");
          if (loc) res.location = loc;
        }
        const entry: Parameters<Recorder["recordReplay"]>[0] = {
          method: "GET",
          url,
          resourceType: signedIn ? "replay" : "replay-anonymous",
          status: res.status,
          bodySample: res.body,
        };
        if (res.contentType) entry.contentType = res.contentType;
        if (res.location) entry.redirectedTo = new URL(res.location, url).toString();
        recorder.recordReplay(entry);
        return res;
      } finally {
        recorder.phase = prev;
      }
    },
  };
}
