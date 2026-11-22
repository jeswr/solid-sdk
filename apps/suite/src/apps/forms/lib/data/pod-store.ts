// AUTHORED-BY Codex (GPT-6.1 Sol)
import { fetchRdf } from "@jeswr/fetch-rdf";
import { createGuardedFetch } from "@jeswr/guarded-fetch";
import { type StorageClient, StorageError } from "@jeswr/storage-client";
import { isomorphic } from "rdf-isomorphic";
import { formUrl } from "../form-url";
import type { FormModel, FormRuntime } from "../runtime";
import { type FormsStore, ResponseSaveUncertainError } from "./store";

interface Allocation {
  url: string;
  shape: string;
  name?: string;
}
/** Prepared containers come from the host's shared storage/discovery layer.
 * Responses are created in the respondent's container. Received links must be
 * supplied by a future reviewed inbox integration; this adapter never crawls pods.
 */
export function createPodFormsStore(options: {
  storage: StorageClient;
  formsContainer: string;
  responsesContainer: string;
  runtime: FormRuntime;
  /** Own storage origin ONLY; the host reader must refuse redirects. */
  readShapes: (shape: string) => ReturnType<StorageClient["readRdf"]>;
  /** Pristine fetch, never session.fetch or an auth wrapper. Required for foreign
   * origins; the store applies guarded-fetch, credentials:omit and redirect:error. */
  publicFetch: typeof fetch;
}): FormsStore {
  const { storage, runtime } = options;
  const versions = new Map<string, string | null>();
  const allocated = new Map<string, Allocation>();
  const responses = new Map<string, Allocation>();
  const isForeign = (url: string) => formUrl(url).origin !== new URL(storage.root).origin;
  const publicFetch = createGuardedFetch({
    fetch: options.publicFetch,
    allowLoopback: process.env.NODE_ENV === "development",
  });
  const documentUrl = (shape: string) => {
    const url = formUrl(shape);
    url.hash = "";
    return url.href;
  };
  const loadForm = async (shape: string) => {
    if (isForeign(shape)) {
      const result = await fetchRdf(documentUrl(shape), {
        fetch: (input, init) =>
          publicFetch(input, { ...init, credentials: "omit", redirect: "error" }),
      });
      return runtime.compileForm(result.dataset, shape);
    }
    const result = await options.readShapes(shape);
    const form = runtime.compileForm(result.dataset, shape);
    versions.set(shape, result.etag);
    return form;
  };
  const allocate = async (
    records: Map<string, Allocation>,
    key: string,
    container: string,
    fragment: string,
  ) => {
    const existing = records.get(key);
    if (existing) return existing;
    let allocation: Allocation;
    if (storage.protocol === "solid") {
      // Named Solid creates are exact conditional PUTs. Build the complete RDF
      // before creation; keep the same name even when the request fails.
      const name = `${crypto.randomUUID()}.ttl`;
      const url = new URL(name, container).href;
      allocation = { url, shape: `${url}#${fragment}`, name };
    } else {
      // LWS assigns the identifier. Remember it BEFORE any subsequent read/write
      // so a failed reservation check or write can never allocate another orphan.
      const created = await storage.create(container, null, { contentType: "text/turtle" });
      allocation = { url: created.url, shape: `${created.url}#${fragment}` };
    }
    records.set(key, allocation);
    return allocation;
  };
  const write = async (allocation: Allocation, container: string, body: string) => {
    if (allocation.name && !versions.has(allocation.shape)) {
      const created = await storage.create(container, body, {
        name: allocation.name,
        contentType: "text/turtle",
      });
      if (created.url !== allocation.url) throw new Error("Unexpected Solid document address");
      versions.set(allocation.shape, created.etagSource === "response" ? created.etag : null);
      return;
    }
    if (!versions.has(allocation.shape)) {
      const fresh = await storage.read(allocation.url);
      if ((await fresh.bytes()).length || !fresh.etag)
        throw new Error("Couldn't reserve an empty, versioned document");
      versions.set(allocation.shape, fresh.etag);
    }
    const etag = versions.get(allocation.shape);
    if (!etag) throw new Error("Reload this form before editing; no safe version is available");
    const result = await storage.write(allocation.url, body, {
      contentType: "text/turtle",
      ifMatch: etag,
    });
    // Only the mutation's own validator can safely authorise a retry after a
    // failed readback. A follow-up HEAD may already name another writer's data.
    versions.set(allocation.shape, result.etagSource === "response" ? result.etag : null);
  };
  return {
    validate: runtime.validate,
    isForeign,
    loadForm,
    async listForms() {
      const forms: FormModel[] = [];
      const skipped: string[] = [];
      for await (const entry of storage.listAll(options.formsContainer)) {
        if (entry.kind !== "resource") continue;
        try {
          forms.push(await loadForm(`${entry.url}#form`));
        } catch {
          skipped.push(entry.url);
        }
      }
      return { forms, skipped };
    },
    async saveForm(form) {
      const allocation =
        allocated.get(form.shape) ??
        (versions.has(form.shape)
          ? { url: documentUrl(form.shape), shape: form.shape }
          : await allocate(allocated, form.shape, options.formsContainer, "form"));
      const saved = { ...form, shape: allocation.shape };
      const body = await runtime.serialize(runtime.formToShapes(saved));
      await write(allocation, options.formsContainer, body);
      return loadForm(allocation.shape);
    },
    // LDN sending and inbox processing are deferred. An empty collection here
    // honestly means no received response links have been integrated yet.
    listResponses: async () => [],
    async submit(form, values) {
      if (!runtime.validate(form, values).valid)
        throw new Error("Review the answers before saving");
      const allocation = await allocate(
        responses,
        form.shape,
        options.responsesContainer,
        "response",
      );
      const graph = runtime.build(form, allocation.shape, values);
      const body = await runtime.serialize(graph);
      // An earlier committed write without a response validator needs readback,
      // never the form editor's reload path or a fresh response allocation.
      let confirm = versions.has(allocation.shape) && !versions.get(allocation.shape);
      if (!confirm) {
        try {
          await write(allocation, options.responsesContainer, body);
        } catch (error) {
          if (
            !(error instanceof StorageError) ||
            (error.code !== "precondition-failed" &&
              !(allocation.name && error.code === "conflict"))
          )
            throw error;
          confirm = true;
        }
      }
      try {
        const read = await storage.readRdf(allocation.url);
        // Compare the runtime's entire graph, including its response subject.
        // An empty graph cannot establish that this submission is present.
        if (confirm && (!graph.size || !isomorphic([...graph], [...read.dataset])))
          throw new ResponseSaveUncertainError();
        const response = {
          subject: allocation.shape,
          form: form.shape,
          values: runtime.parse(form, allocation.shape, read.dataset),
        };
        versions.set(allocation.shape, read.etag);
        responses.delete(form.shape);
        return response;
      } catch {
        throw new ResponseSaveUncertainError();
      }
    },
  };
}
