// AUTHORED-BY Codex (GPT-6.1 Sol)
import { parseRdf } from "@jeswr/fetch-rdf";
import type { StorageClient } from "@jeswr/storage-client";
import type { FormModel, FormRuntime } from "../runtime";
import type { FormsStore } from "./store";

/** Prepared containers come from the host's shared storage/discovery layer.
 * Responses are created in the respondent's container. Received links must be
 * supplied by a future reviewed inbox integration; this adapter never crawls pods.
 */
export function createPodFormsStore(options: {
  storage: StorageClient;
  formsContainer: string;
  responsesContainer: string;
  runtime: FormRuntime;
  readShapes: (shape: string) => ReturnType<StorageClient["readRdf"]>;
}): FormsStore {
  const { storage, runtime } = options;
  const versions = new Map<string, string | null>();
  const allocated = new Map<string, string>();
  const documentUrl = (shape: string) => {
    const url = new URL(shape);
    url.hash = "";
    return url.href;
  };
  const loadForm = async (shape: string) => {
    const result = await options.readShapes(shape);
    versions.set(shape, result.etag);
    return runtime.compileForm(result.dataset, shape);
  };
  // Reserve first so LWS can assign an identifier. The empty-read ETag prevents
  // a concurrent writer being overwritten between allocation and serialisation.
  const reserve = async (container: string) => {
    const created = await storage.create(container, null, { contentType: "text/turtle" });
    const fresh = await storage.read(created.url);
    if ((await fresh.bytes()).length || !fresh.etag)
      throw new Error("Couldn't reserve an empty, versioned document");
    return { url: created.url, etag: fresh.etag };
  };
  return {
    validate: runtime.validate,
    loadForm,
    async listForms() {
      const forms: FormModel[] = [];
      for await (const entry of storage.listAll(options.formsContainer)) {
        if (entry.kind === "resource") forms.push(await loadForm(`${entry.url}#form`));
      }
      return forms;
    },
    async saveForm(form) {
      let shape = allocated.get(form.shape) ?? form.shape;
      let url = documentUrl(shape);
      let etag = versions.get(shape);
      if (!versions.has(shape)) {
        const reserved = await reserve(options.formsContainer);
        url = reserved.url;
        etag = reserved.etag;
        shape = `${url}#form`;
      }
      if (!etag) throw new Error("Reload this form before editing; no safe version is available");
      const saved = { ...form, shape };
      const body = await runtime.serialize(runtime.formToShapes(saved));
      await storage.write(url, body, { contentType: "text/turtle", ifMatch: etag });
      // Read content and ETag together. Never use a follow-up HEAD's validator.
      const result = await loadForm(shape);
      allocated.set(form.shape, shape);
      return result;
    },
    // LDN sending and inbox processing are deferred. An empty collection here
    // honestly means no received response links have been integrated yet.
    listResponses: async () => [],
    async submit(form, values) {
      if (!runtime.validate(form, values).valid)
        throw new Error("Review the answers before saving");
      const reserved = await reserve(options.responsesContainer);
      const subject = `${reserved.url}#response`;
      const body = await runtime.serialize(runtime.build(form, subject, values));
      await storage.write(reserved.url, body, {
        contentType: "text/turtle",
        ifMatch: reserved.etag,
      });
      const read = await storage.read(reserved.url);
      const graph = await parseRdf(read.body ?? "", read.contentType, { baseIRI: reserved.url });
      return { subject, form: form.shape, values: runtime.parse(form, subject, graph) };
    },
  };
}
