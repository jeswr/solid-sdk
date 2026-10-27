// AUTHORED-BY Codex GPT-6
import { extractMediaType, parseRdf, SUPPORTED_RDF_MEDIA_TYPES } from "@jeswr/fetch-rdf";
import { Group } from "@solid/object";
import { DataFactory, Store } from "n3";
import { readAccess, writeAccess } from "./access.js";
import { executions } from "./planner.js";
import {
  assertNotWider,
  effectivePolicy,
  ownerPolicy,
  policiesEqual,
  scopePolicy,
  unionPolicies,
} from "./policy.js";
import { aclLink, parent, parse, requireOk, requireRepresentation, serialize } from "./rdf.js";
import type {
  AccessDocument,
  EffectivePolicy,
  ExecutablePlan,
  MigrationResult,
  PodSide,
  Progress,
} from "./types.js";

/** Rewrite RDF term positions through the parsed dataset; literal strings remain verbatim. */
export async function rewriteRdf(
  bytes: Uint8Array,
  contentType: string,
  sourceRoot: string,
  targetRoot: string,
  sourceUrl: string,
): Promise<Uint8Array> {
  const dataset = await parseRdf(
    new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    contentType,
    { baseIRI: sourceUrl },
  );
  const output = new Store();
  const rewrite = (term: import("@rdfjs/types").Term) =>
    term.termType === "NamedNode" && term.value.startsWith(sourceRoot)
      ? DataFactory.namedNode(targetRoot + term.value.slice(sourceRoot.length))
      : term;
  // Existing RDF quads are mapped, not manually authored graphs.
  for (const quad of dataset)
    output.addQuad(
      DataFactory.quad(
        rewrite(quad.subject) as typeof quad.subject,
        rewrite(quad.predicate) as typeof quad.predicate,
        rewrite(quad.object) as typeof quad.object,
        rewrite(quad.graph) as typeof quad.graph,
      ),
    );
  return new TextEncoder().encode(await serialize(output));
}
export async function executeMigration(
  executable: ExecutablePlan,
  opts: {
    source: PodSide;
    target: PodSide;
    signal?: AbortSignal;
    onProgress?: (p: Progress) => void;
  },
): Promise<MigrationResult> {
  const execution = executions.get(executable);
  if (!execution) throw new TypeError("Execute requires a finalized engine plan");
  const { state, resources } = execution;
  for (const name of ["source", "target"] as const)
    if (
      opts[name].http !== state[name].http ||
      opts[name].root !== state[name].root ||
      opts[name].ownerWebId !== state[name].ownerWebId
    )
      throw new TypeError("Execution sessions differ from planning sessions");
  executions.delete(executable); // A plan is single-use, including cancelled/failed attempts.
  const result: MigrationResult = {
    copied: [],
    skipped: [],
    failed: [],
    aclWritten: [],
    verified: false,
    cancelled: false,
    log: [],
  };
  let current = state.target.root;
  function persist(): void {
    try {
      globalThis.sessionStorage?.setItem("pod-migrator:last-run", JSON.stringify(result));
    } catch {
      /* Storage quota/privacy settings must not interrupt safe locking. */
    }
  }
  function log(level: "info" | "warn" | "error", message: string): void {
    result.log.push({ at: new Date().toISOString(), level, message });
    persist();
  }
  function progress(phase: Progress["phase"], done: number, total: number, url: string): void {
    opts.onProgress?.({ phase, done, total, current: url });
  }
  const active = resources.filter((entry) => !entry.skipped);
  for (const entry of resources.filter((entry) => entry.skipped))
    result.skipped.push({
      url: entry.state.resource.sourceUrl,
      reason: "Skipped by review decision",
    });
  const context = {
    sourceOwner: state.source.ownerWebId,
    targetOwner: state.target.ownerWebId,
    groups: state.groups,
  };
  const aclUrls = new Map<string, string>();
  const aclEtags = new Map<string, string>();
  const bytesCopied = new Map<string, Uint8Array>();
  const written = new Map<string, EffectivePolicy>();
  const checkCancel = () => opts.signal?.throwIfAborted();
  async function currentDocuments(
    side: PodSide,
    urls: string[],
    system: typeof state.sourceSystem,
  ): Promise<Map<string, AccessDocument | undefined>> {
    const docs = new Map<string, AccessDocument | undefined>();
    if (system === "unknown") return docs;
    for (const resource of urls) {
      let url: string | undefined = resource;
      while (url !== undefined) {
        if (!docs.has(url)) {
          docs.set(url, await readAccess(side, url, system, opts.signal));
        }
        url = parent(url, side.root);
      }
    }
    return docs;
  }
  async function writeAcl(
    url: string,
    policy: EffectivePolicy,
    mergeDocument?: AccessDocument,
  ): Promise<void> {
    const acl = aclUrls.get(url);
    if (!acl) throw new TypeError("Target has no discoverable ACL link");
    const etag = aclEtags.get(url);
    const response = await writeAccess(
      state.target,
      url,
      acl,
      policy,
      state.targetSystem,
      state.dialect,
      etag ? { ifMatch: etag } : { ifNoneMatch: "*" },
      mergeDocument,
    );
    const nextEtag = response.headers.get("etag");
    if (nextEtag) aclEtags.set(url, nextEtag);
    else aclEtags.delete(url);
    result.aclWritten.push(acl);
    written.set(url, policy);
    log("info", `Wrote access controls for ${url}`);
  }
  try {
    checkCancel();
    // Re-read all relevant access documents before the first write; stale reviews fail closed.
    const sourceDocs = await currentDocuments(
      state.source,
      active.filter((e) => !e.state.unreadable).map((e) => e.state.resource.sourceUrl),
      state.sourceSystem,
    );
    const targetDocs = await currentDocuments(
      state.target,
      active.map((e) => e.state.resource.targetUrl),
      state.targetSystem,
    );
    for (const [group, expected] of state.groups) {
      const url = group.split("#")[0] as string;
      const dataset = await parse(
        requireOk(await state.source.http.get(url, { accept: "text/turtle", signal: opts.signal })),
        url,
      );
      const actual = [...new Group(group, dataset, DataFactory).hasMember];
      if (JSON.stringify(actual.sort()) !== JSON.stringify([...expected].sort()))
        throw new TypeError("Group membership changed; create a new plan");
    }
    for (const entry of active) {
      current = entry.state.resource.targetUrl;
      const head = await state.target.http.head(current, { signal: opts.signal });
      if (
        entry.state.exists
          ? !head.ok || head.headers.get("etag") !== entry.state.targetEtag
          : head.status !== 404
      )
        throw new TypeError("Target changed after review");
      const targetEffective = effectivePolicy(
        state.targetSystem,
        current,
        state.target.root,
        targetDocs,
      );
      if (!policiesEqual(entry.state.targetEffective, targetEffective))
        throw new TypeError("Target permissions changed after review");
      const sourceEffective = effectivePolicy(
        state.sourceSystem,
        entry.state.resource.sourceUrl,
        state.source.root,
        sourceDocs,
      );
      const actualPolicy =
        entry.decision === "overwrite"
          ? targetEffective
          : entry.decision === "merge"
            ? unionPolicies(targetEffective, scopePolicy(entry.policy, "resource"))
            : entry.policy;
      assertNotWider(sourceEffective, scopePolicy(actualPolicy, "resource"), context);
      const acl = aclLink(head, current, state.target.root);
      if (acl) aclUrls.set(current, acl);
      const doc = targetDocs.get(current);
      if (entry.decision === "merge" && doc?.etag !== entry.state.targetDocument?.etag)
        throw new TypeError("Root access document changed after review");
      if (doc?.etag) aclEtags.set(current, doc.etag);
    }
    const containers = active
      .filter((e) => e.state.resource.kind === "container")
      .sort((a, b) => a.state.resource.targetUrl.length - b.state.resource.targetUrl.length);
    for (const [index, entry] of containers.entries()) {
      checkCancel();
      current = entry.state.resource.targetUrl;
      if (!entry.state.exists) {
        const response = requireOk(
          await state.target.http.put(current, "", {
            contentType: "text/turtle",
            ifNoneMatch: "*",
          }),
        );
        const acl =
          aclLink(response, current, state.target.root) ??
          aclLink(await state.target.http.head(current), current, state.target.root);
        if (acl) aclUrls.set(current, acl);
        await writeAcl(current, ownerPolicy(state.target.ownerWebId, true));
      }
      progress("lock", index + 1, containers.length, current);
    }
    const files = active.filter((e) => e.state.resource.kind === "resource");
    for (const [index, entry] of files.entries()) {
      checkCancel();
      current = entry.state.resource.targetUrl;
      const source = requireRepresentation(
        await state.source.http.get(entry.state.resource.sourceUrl, { signal: opts.signal }),
      );
      let bytes = new Uint8Array(await source.arrayBuffer());
      let contentType = source.headers.get("content-type") ?? "application/octet-stream";
      if (
        state.rewriteIris &&
        SUPPORTED_RDF_MEDIA_TYPES.some((type) => type === extractMediaType(contentType))
      ) {
        bytes = await rewriteRdf(
          bytes,
          contentType,
          state.source.root,
          new URL(
            current.slice(
              0,
              current.length -
                entry.state.resource.sourceUrl.slice(state.source.root.length).length,
            ),
          ).href,
          entry.state.resource.sourceUrl,
        );
        contentType = "application/trig";
      }
      checkCancel();
      let etag = entry.state.targetEtag;
      if (!entry.state.exists) {
        const placeholder = requireOk(
          await state.target.http.put(current, new Uint8Array(), { contentType, ifNoneMatch: "*" }),
        );
        etag = placeholder.headers.get("etag") ?? undefined;
        const acl =
          aclLink(placeholder, current, state.target.root) ??
          aclLink(await state.target.http.head(current), current, state.target.root);
        if (acl) aclUrls.set(current, acl);
        await writeAcl(current, ownerPolicy(state.target.ownerWebId));
      }
      if (!etag) throw new TypeError("Safe content writes require an ETag");
      checkCancel();
      requireOk(await state.target.http.put(current, bytes, { contentType, ifMatch: etag }));
      bytesCopied.set(current, bytes);
      result.copied.push(current);
      log("info", `Copied ${current}`);
      progress("copy", index + 1, files.length, current);
    }
    const grants = active
      .filter((e) => e.decision !== "overwrite")
      .sort((a, b) => b.state.resource.targetUrl.length - a.state.resource.targetUrl.length);
    for (const [index, entry] of grants.entries()) {
      checkCancel();
      current = entry.state.resource.targetUrl;
      let policy = entry.policy;
      if (entry.decision === "merge") {
        const original = entry.state.targetDocument as AccessDocument;
        policy = unionPolicies(original.policy, scopePolicy(entry.policy, "resource"));
      }
      if (!entry.state.unreadable) {
        const documents = await currentDocuments(
          state.source,
          [entry.state.resource.sourceUrl],
          state.sourceSystem,
        );
        const currentSource = effectivePolicy(
          state.sourceSystem,
          entry.state.resource.sourceUrl,
          state.source.root,
          documents,
        );
        assertNotWider(currentSource, scopePolicy(policy, "resource"), context);
      }
      await writeAcl(
        current,
        policy,
        entry.decision === "merge" ? entry.state.targetDocument : undefined,
      );
      progress("grant", index + 1, grants.length, current);
    }
    for (const [index, entry] of active.entries()) {
      checkCancel();
      current = entry.state.resource.targetUrl;
      const expected = written.get(current);
      if (expected) {
        const actual = await readAccess(state.target, current, state.targetSystem, opts.signal);
        if (
          !actual ||
          !policiesEqual(
            scopePolicy(expected, "resource"),
            scopePolicy(actual.policy, "resource"),
          ) ||
          !policiesEqual(scopePolicy(expected, "members"), scopePolicy(actual.policy, "members"))
        )
          throw new TypeError("Access verification failed");
      }
      const bytes = bytesCopied.get(current);
      if (bytes) {
        const actual = new Uint8Array(
          await requireRepresentation(
            await state.target.http.get(current, { signal: opts.signal }),
          ).arrayBuffer(),
        );
        if (actual.length !== bytes.length || actual.some((value, i) => value !== bytes[i]))
          throw new TypeError("Content verification failed");
      }
      progress("verify", index + 1, active.length, current);
    }
    result.verified = true;
    log("info", "Migration verified");
  } catch (error) {
    if (opts.signal?.aborted) {
      result.cancelled = true;
      log("warn", "Migration cancelled; completed writes retain their safe permissions");
    } else {
      const message = error instanceof Error ? error.message : String(error);
      result.failed.push({ url: current, error: message });
      log("error", message);
    }
  }
  for (const entry of active)
    if (
      entry.state.resource.kind === "resource" &&
      !result.copied.includes(entry.state.resource.targetUrl)
    )
      result.skipped.push({
        url: entry.state.resource.sourceUrl,
        reason: result.cancelled ? "Cancelled before copy completed" : "Copy did not complete",
      });
  persist();
  return result;
}
