// AUTHORED-BY Codex (GPT-6.1 Sol)
// AUTHORED-BY Codex GPT-6
import { fetchRdf } from "@jeswr/fetch-rdf";
import { createGuardedFetch } from "@jeswr/guarded-fetch";
import { checkOwnerOnly, createOwnerOnlyDestinationVerifier } from "@jeswr/pod-access";
import { isAuxiliaryResource, type StorageClient, StorageError } from "@jeswr/storage-client";
import { isomorphic } from "rdf-isomorphic";
import { formUrl } from "../form-url";
import type { FormModel, FormRuntime } from "../runtime";
import { type FormsStore, ResponsePrivacyError, ResponseSaveUncertainError } from "./store";

interface Allocation {
  url: string;
  shape: string;
  name?: string;
  etag?: string | null;
}
function isCreateConflict(error: unknown) {
  return error instanceof StorageError && error.code === "conflict" && error.status === 412;
}

/** Prepared containers come from the host's shared storage/discovery layer. */
export function createPodFormsStore(options: {
  /** The host's authenticated, signal-aware storage client. */
  storage: StorageClient;
  ownerWebId: string;
  formsContainer: string;
  responsesContainer: string;
  runtime: FormRuntime;
  /** Within the user's storage only. The host reader must refuse redirects. */
  readShapes: (shape: string) => ReturnType<StorageClient["readRdf"]>;
  /** Pristine fetch, never session.fetch or an auth wrapper. */
  publicFetch: typeof fetch;
}): FormsStore {
  const { storage, runtime, ownerWebId, formsContainer, responsesContainer } = options;
  const allocated = new Map<string, Allocation>();
  const responses = new Map<string, Allocation>();
  const verifySolidDestination = createOwnerOnlyDestinationVerifier({
    podRoot: storage.root,
    ownerWebId,
    openStorage: () => storage,
  });
  const publicFetch = createGuardedFetch({
    fetch: options.publicFetch,
    allowLoopback: process.env.NODE_ENV === "development",
  });
  const documentUrl = (shape: string) => {
    const url = formUrl(shape);
    url.hash = "";
    return url.href;
  };
  const isForeign = (shape: string) => !storage.isWithinStorage(documentUrl(shape));
  const readForm = async (shape: string, url: string) => {
    if (!storage.isWithinStorage(url)) {
      const result = await fetchRdf(url, {
        fetch: (input, init) =>
          publicFetch(input, { ...init, credentials: "omit", redirect: "error" }),
      });
      return { ...result, etag: null };
    }
    return options.readShapes(shape);
  };
  const compile = (shape: string, read: Awaited<ReturnType<typeof readForm>>): FormModel => ({
    ...runtime.compileForm(read.dataset, shape),
    shape,
    editVersion: { shape, etag: read.etag },
  });
  const loadForm = async (shape: string) =>
    compile(shape, await readForm(shape, documentUrl(shape)));
  const requireMember = async (url: string, container: string) => {
    const refuse = () => new Error("Only form documents in the forms container can be edited");
    if (!storage.isWithinStorage(url) || isAuxiliaryResource(url)) throw refuse();
    const head = await storage.head(url, { revalidate: true });
    if (head.kind !== "resource" || head.parent !== container || isAuxiliaryResource(url, head))
      throw refuse();
  };
  const requirePrivate = async (verify: () => Promise<boolean>) => {
    try {
      if (await verify()) return;
    } catch {
      // Treat an unavailable access policy as a refusal too.
    }
    throw new ResponsePrivacyError();
  };
  const ownerOnly = async (url: string) =>
    (await checkOwnerOnly({ storage, url, ownerWebId })).private;
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
      // Named Solid creates use an exact conditional PUT.
      const name = `${crypto.randomUUID()}.ttl`;
      const url = new URL(name, container).href;
      allocation = { url, shape: `${url}#${fragment}`, name };
    } else {
      // The SDK verifies the returned resource kind, logical parent and auxiliary status.
      const created = await storage.create(container, null, { contentType: "text/turtle" });
      allocation = { url: created.url, shape: `${created.url}#${fragment}` };
    }
    // Keep the identity across failed reservation checks, writes and readbacks.
    records.set(key, allocation);
    return allocation;
  };
  const write = async (allocation: Allocation, container: string, body: string) => {
    if (allocation.name && allocation.etag === undefined) {
      const created = await storage.create(container, body, {
        name: allocation.name,
        contentType: "text/turtle",
      });
      if (created.url !== allocation.url) throw new Error("Unexpected Solid document address");
      allocation.etag = created.etagSource === "response" ? created.etag : null;
      return;
    }
    if (allocation.etag === undefined) {
      const fresh = await storage.read(allocation.url, {
        maxBytes: 0,
        signal: AbortSignal.timeout(10_000),
      });
      if ((await fresh.bytes()).length || !fresh.etag)
        throw new Error("Couldn't reserve an empty, versioned document");
      allocation.etag = fresh.etag;
    }
    const etag = allocation.etag;
    if (!etag || etag === "*")
      throw new Error("Reload this form before editing; no safe version is available");
    const result = await storage.write(allocation.url, body, {
      contentType: "text/turtle",
      ifMatch: etag,
    });
    // A follow-up HEAD may already name another writer's data.
    allocation.etag = result.etagSource === "response" ? result.etag : null;
  };
  return {
    validate: runtime.validate,
    isForeign,
    loadForm,
    async listForms() {
      const forms: FormModel[] = [];
      const skipped: string[] = [];
      for await (const entry of storage.listAll(formsContainer)) {
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
      const { editVersion, ...model } = form;
      let allocation: Allocation;
      if (editVersion) {
        if (editVersion.shape !== form.shape) throw new Error("Reload this form before editing");
        const url = documentUrl(form.shape);
        await requireMember(url, formsContainer);
        allocation = { url, shape: form.shape, etag: editVersion.etag };
      } else {
        allocation = await allocate(allocated, form.shape, formsContainer, "form");
      }
      const graph = runtime.formToShapes({ ...model, shape: allocation.shape });
      const body = await runtime.serialize(graph);
      let recovering = false;
      try {
        await write(allocation, formsContainer, body);
      } catch (error) {
        if (!allocation.name || !isCreateConflict(error)) throw error;
        await requireMember(allocation.url, formsContainer);
        recovering = true;
      }
      const read = await readForm(allocation.shape, allocation.url);
      if ((recovering && !graph.size) || !isomorphic([...graph], [...read.dataset]))
        throw new Error("The saved form couldn't be confirmed. Reload before editing.");
      if (!editVersion) allocation.etag = read.etag;
      return compile(allocation.shape, read);
    },
    // Received links require a reviewed inbox integration.
    listResponses: async () => [],
    async submit(form, values) {
      if (!runtime.validate(form, values).valid)
        throw new Error("Review the answers before saving");
      await requirePrivate(() => ownerOnly(responsesContainer));
      const allocation = await allocate(responses, form.shape, responsesContainer, "response");
      await requirePrivate(() =>
        allocation.name ? verifySolidDestination(allocation.url) : ownerOnly(allocation.url),
      );
      const graph = runtime.build(form, allocation.shape, values);
      const body = await runtime.serialize(graph);
      // An earlier committed write without its own validator needs confirmation.
      if (allocation.etag !== null) {
        try {
          await write(allocation, responsesContainer, body);
        } catch (error) {
          if (
            !(error instanceof StorageError && error.code === "precondition-failed") &&
            !(allocation.name && isCreateConflict(error))
          )
            throw error;
        }
      }
      try {
        const read = await storage.readRdf(allocation.url);
        if (!graph.size || !isomorphic([...graph], [...read.dataset]))
          throw new ResponseSaveUncertainError();
        const response = {
          subject: allocation.shape,
          form: form.shape,
          values: runtime.parse(form, allocation.shape, read.dataset),
        };
        responses.delete(form.shape);
        return response;
      } catch {
        throw new ResponseSaveUncertainError();
      }
    },
  };
}
