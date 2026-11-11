// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Claude Opus 5.5
/**
 * Shared-context tools (decisions/0004, use case 3). The shared context is one owner-authored
 * Markdown document in the pod that every conversation can start from: how the owner works,
 * their accounts and standing preferences. Discovery is private-index-first with a fixed fallback;
 * no model-supplied URL ever reaches the pod.
 */
import {
  CARD_REDACTION as MEMORY_CARD_REDACTION,
  findCardNumbers as memoryFindCardNumbers,
  redactCardNumbers as memoryRedactCardNumbers,
} from "@jeswr/pkg-memory";
import { z } from "zod";
import { requirePodScopedUrl } from "./auth.js";
import { MAX_CONTENT_BYTES } from "./content.js";
import { protectContextResource, verifyContextAcl } from "./context-access.js";
import {
  ContextDiscoveryError,
  type ContextDiscoveryReason,
  contextTypeIndex,
  SHARED_CONTEXT_PATH,
} from "./context-discovery.js";
import { status } from "./memory-context.js";
import { withPodReadLimits } from "./pod-operation.js";
import type { PodPort, PodReadResult } from "./pod-port.js";
import { defineTool, type PodTool, toolText } from "./tool.js";

/** Conventional location of the shared-context document, relative to the pod root. */
export { SHARED_CONTEXT_PATH } from "./context-discovery.js";

/** Media types accepted as the shared-context document. */
const CONTEXT_MEDIA_TYPES = new Set(["text/markdown", "text/plain"]);

/** Absolute URL of the shared-context document under `root`. */
export function sharedContextUrl(root: string): string {
  return requirePodScopedUrl({ podRoot: root }, new URL(SHARED_CONTEXT_PATH, root).href);
}

/** The result of reading the shared-context document. */
export type SharedContextResult =
  | {
      status: "ok";
      url: string;
      contentType: string;
      etag?: string;
      text: string;
      /** How many card-number-like digit runs were replaced with {@link CARD_REDACTION}. */
      redactedCardNumbers: number;
      /** True only when the effective WAC ACL was proven owner-only for mutations. */
      aclVerified: boolean;
    }
  | { status: "not_found"; url: string; setup: string }
  | { status: "error"; reason: ContextDiscoveryReason }
  | { status: "untrusted"; url: string; reason: "public_write" | "acl_unverifiable" };

/** Absent: a structured 404/410, or the fetch adapter's exact "failed to read <url>: HTTP 404". */
function isNotFound(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const status = (error as { status?: unknown }).status;
  if (status === 404 || status === 410) return true;
  return error instanceof Error && /^failed to read \S+: HTTP (?:404|410)\b/.test(error.message);
}

// Retain the original module exports for existing callers.
export const CARD_REDACTION = MEMORY_CARD_REDACTION;
export const findCardNumbers: (text: string) => Array<[number, number]> = memoryFindCardNumbers;
export const redactCardNumbers: (text: string, marker?: string) => { text: string; count: number } =
  memoryRedactCardNumbers;

/** Read the shared-context document; a missing document is a result, not an error. */
export async function readSharedContext(pod: PodPort): Promise<SharedContextResult> {
  let discoveryComplete = false;
  return withPodReadLimits<SharedContextResult>(async () => {
    let url = sharedContextUrl(pod.root);
    let registered = false;
    try {
      if (pod.webId) {
        const instance = await contextTypeIndex(pod).discover();
        if (instance) {
          url = instance;
          registered = true;
        }
      }
    } catch (error) {
      return {
        status: "error" as const,
        reason:
          error instanceof ContextDiscoveryError
            ? error.reason
            : ("type_index_unreadable" as const),
      };
    }
    discoveryComplete = true;
    let raw: PodReadResult;
    try {
      // Refuse redirects at the transport; never read an alias or redirect target.
      raw = await pod.read(url, { redirect: "error" });
    } catch (error) {
      if (isNotFound(error))
        return {
          status: "not_found" as const,
          url,
          setup: `No shared context yet. The owner can create ${url} as Markdown with owner-only access.`,
        };
      throw error;
    }
    // Portable ports report aliases through url; text and ETag must describe this exact document.
    if (raw.url !== undefined && raw.url !== url) throw new Error("redirect refused");
    if (raw.isContainer) {
      if (registered) return { status: "error", reason: "registration_container" };
      throw new Error("redirect refused");
    }
    if (raw.body.byteLength > MAX_CONTENT_BYTES)
      throw new Error("Resource exceeds the bounded read limit.");
    const contentType = (raw.contentType.split(";").shift() ?? "").trim().toLowerCase();
    if (!CONTEXT_MEDIA_TYPES.has(contentType)) throw new Error("unreadable");
    let aclVerified: boolean;
    try {
      aclVerified = await verifyContextAcl(pod, url, raw);
    } catch (error) {
      return {
        status: "untrusted" as const,
        url,
        reason:
          error instanceof Error && error.message === "public_write"
            ? ("public_write" as const)
            : ("acl_unverifiable" as const),
      };
    }
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(raw.body);
    // Card data belongs in the knowledge graph's mandate path, never in shared context.
    const { text, count } = redactCardNumbers(decoded);
    return {
      status: "ok" as const,
      url,
      contentType,
      ...(raw.etag ? { etag: raw.etag } : {}),
      text,
      redactedCardNumbers: count,
      aclVerified,
    };
  }).catch((error): SharedContextResult => {
    if (!discoveryComplete) return { status: "error", reason: "type_index_unreadable" };
    throw error;
  });
}

/** Build the shared-context tools. Models have read-only access. */
export function createContextToolRegistry(pod: PodPort): readonly PodTool[] {
  return [
    defineTool(
      {
        name: "context_read",
        aliases: [],
        title: "Read the owner's shared context",
        readOnly: true,
        description:
          "Read the owner's shared context: their Markdown working preferences and accounts. Call at the start of a conversation. Discovers one SharedContext instance in the owner's private Type Index, otherwise uses the conventional path. Returns {status:'ok',url,contentType,etag?,text,redactedCardNumbers,aclVerified}, {status:'not_found',url,setup}, {status:'error',reason} for unsafe discovery, or {status:'untrusted',url,reason} with no text for unsafe/unverifiable ACL evidence. aclVerified:true proves only the owner may write, append or control; false means the backend exposes no ACL capability. Card-like Unicode digit runs are redacted.",
        inputSchema: z.object({}).strict(),
        async handler() {
          return toolText(JSON.stringify(await readSharedContext(pod)));
        },
      },
      true,
    ),
  ];
}

/** Owner-facing setup outcome; no model tool can invoke setup. */
export type SharedContextSetupResult =
  | { status: "created" | "already_exists"; url: string; registered: boolean }
  | {
      status: "error";
      reason: ContextDiscoveryReason | "foreign_registration" | "setup_failed";
      setup?: string;
    };

/** Create-only owner setup. Existing document bytes and existing registrations are preserved. */
export async function setupSharedContext(
  pod: PodPort,
  options: { webId: string; initialText?: string },
): Promise<SharedContextSetupResult> {
  return withPodReadLimits<SharedContextSetupResult>(async () => {
    try {
      const owner = new URL(options.webId);
      if (
        !/^https?:$/.test(owner.protocol) ||
        owner.username ||
        owner.password ||
        (pod.webId && pod.webId !== options.webId)
      )
        throw new Error("Invalid context owner");
      // Delegate through current methods and retain their receiver, including class-based ports.
      const port: PodPort = {
        root: pod.root,
        webId: options.webId,
        read: (url, opts) => pod.read(url, opts),
        list: (url) => pod.list(url),
        write: (url, body, type, cond) => pod.write(url, body, type, cond),
        delete: (url, cond) => pod.delete(url, cond),
        head: pod.head
          ? (url) => {
              if (!pod.head) throw new Error("WAC protection unavailable");
              return pod.head(url);
            }
          : undefined,
      };
      const url = sharedContextUrl(port.root);
      const protect = (target: string, inherit: boolean) =>
        protectContextResource(port, target, inherit);
      const index = contextTypeIndex(port, protect);
      const registration = await index.discover();
      if (registration && registration !== url)
        return { status: "error", reason: "foreign_registration" };
      let existing: PodReadResult | undefined;
      try {
        existing = await port.read(url, { redirect: "error" });
      } catch (error) {
        if (status(error) !== 404) throw error;
      }
      if (existing && ((existing.url && existing.url !== url) || existing.isContainer))
        throw new Error("redirect refused");
      if (!existing) {
        const bytes = new TextEncoder().encode(options.initialText ?? "# Shared context\n");
        if (bytes.byteLength > MAX_CONTENT_BYTES) throw new Error("Context exceeds bounded limit");
        // Protect ancestors before creation too: some Solid servers create them implicitly.
        for (const path of ["agent/", "agent/context/"]) {
          const target = new URL(path, port.root).href;
          let present = false;
          try {
            await port.read(target, { redirect: "error" });
            present = true;
          } catch (error) {
            if (status(error) !== 404) throw error;
          }
          if (!present) {
            await protect(target, true);
            try {
              await port.write(target, new Uint8Array(), "text/turtle", { ifNoneMatch: "*" });
            } catch (error) {
              if (status(error) !== 412) throw error;
            }
          }
        }
        await protect(url, false);
        try {
          await port.write(url, bytes, "text/markdown", { ifNoneMatch: "*" });
        } catch (error) {
          if (status(error) !== 412) throw error;
          existing = await port.read(url, { redirect: "error" });
        }
      }
      // Never register an existing or raced-in document without verified owner-only writes.
      const saved = await port.read(url, { redirect: "error" });
      if (
        (saved.url && saved.url !== url) ||
        saved.isContainer ||
        !(await verifyContextAcl(port, url, saved))
      )
        throw new Error("acl_unverifiable");
      if (!registration) await index.register(url);
      return { status: existing ? "already_exists" : "created", url, registered: true };
    } catch (error) {
      return {
        status: "error",
        reason: error instanceof ContextDiscoveryError ? error.reason : "setup_failed",
        ...(error instanceof ContextDiscoveryError && error.reason === "pointer_acl_untrusted"
          ? {
              setup:
                "The owner must fix the effective private type index/preferences ACLs to allow only owner mutations, then rerun context-init.",
            }
          : {}),
      };
    }
  }).catch(() => ({ status: "error" as const, reason: "setup_failed" as const }));
}
