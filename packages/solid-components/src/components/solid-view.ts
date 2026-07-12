// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// <solid-view> — the COMPOSITION element. Point it at a Solid resource and it picks
// the right typed element for you: fetch the resource, read its `rdf:type`, consult
// the committed `resolveComponent` map, lazy-import + mount the matching element
// (forwarding the same fetch seam + `src`). The "just render whatever is at this URL"
// entry point an LLM-generated app reaches for.
//
//   <solid-view src="https://alice.example/tasks/"></solid-view>
//   const v = document.createElement("solid-view");
//   v.fetch = session.fetch; v.src = "https://alice.example/contacts/";
//
// SELECTION IS THE EXTRACTED PM PATTERN (cited in resolver.ts): we read the
// resource's `rdf:type` set with `collectTypes` (PM's `collectTypes` rdf:type scan)
// and pass it to `resolveComponent` (PM's `selectTypedViewer` priority+tie-break over
// the static map). We do NOT reinvent a parallel typed-views registry — `<solid-view>`
// is a thin driver over the one resolver. Unknown / untyped resources fall back to
// `<jeswr-collection>` when the resource is an LDP container, else show a neutral
// "no typed view" state (a generic RDF view is a documented follow-up).
//
// CREDENTIAL BOUNDARY: the fetch seam (`fetch` / `publicFetch` / `public-read`) is
// forwarded verbatim to the DataController for the type probe AND to the mounted
// child element, so the same fail-closed public-read rule applies end to end. The
// session token never leaks to a foreign origin.

import { html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import { DataController, type DataSeam } from "../data-controller.js";
import { DataControllerError } from "../errors.js";
import {
  type ComponentEntry,
  type ComponentMode,
  collectTypes,
  resolveComponent,
  resolveComponentForClass,
} from "../resolver.js";
import { LDP_BASIC_CONTAINER, LDP_CONTAINER } from "../vocab.js";

/** The lifecycle of a <solid-view> resolution. */
type ViewStatus = "idle" | "loading" | "ready" | "unsupported" | "error";

/** The input props that re-trigger a resolve. */
const INPUT_PROPS = ["src", "classIri", "mode", "fetch", "publicFetch", "publicRead"];

export class SolidView extends LitElement {
  /** The resource URL to render. Setting it re-resolves. */
  declare src: string | undefined;
  /**
   * Optionally PIN the RDF class to render as, skipping the type probe entirely (the
   * codegen "I know it's a wf:Task" path). A plain class IRI string. When set, the
   * resolver maps it directly and no network probe is done before mount.
   */
  declare classIri: string | undefined;
  /** Constrain resolution to a mode (Phase-1 is always `view`). */
  declare mode: ComponentMode;
  /** The session-bound authenticated fetch. */
  declare fetch: typeof fetch | undefined;
  /** The credential-free fetch for foreign/public reads (no fallback — see DataSeam). */
  declare publicFetch: typeof fetch | undefined;
  /** Probe + read with the public (credential-free) fetch — for a foreign-origin `src`. */
  declare publicRead: boolean;

  private declare status: ViewStatus;
  private declare errorMessage: string;
  private declare resolved: ComponentEntry | undefined;

  /** A supersede token so a stale probe never mounts over a newer one. */
  #token = 0;

  static properties = {
    src: {},
    classIri: { attribute: "class-iri" },
    mode: {},
    fetch: { attribute: false },
    publicFetch: { attribute: false },
    publicRead: { type: Boolean, attribute: "public-read" },
    status: { state: true },
    errorMessage: { state: true },
    resolved: { state: true },
  };

  constructor() {
    super();
    this.src = undefined;
    this.classIri = undefined;
    this.mode = "view";
    this.fetch = undefined;
    this.publicFetch = undefined;
    this.publicRead = false;
    this.status = "idle";
    this.errorMessage = "";
    this.resolved = undefined;
  }

  /** Light DOM so the consuming app can `::part`/style the mounted child. */
  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  override willUpdate(changed: PropertyValues<this>): void {
    const changedKeys = changed as unknown as Map<string, unknown>;
    if (INPUT_PROPS.some((k) => changedKeys.has(k))) void this.#resolve();
  }

  async #resolve(): Promise<void> {
    const token = ++this.#token;
    const src = this.src;
    if (!src) {
      this.resolved = undefined;
      this.errorMessage = "";
      this.status = "idle";
      return;
    }

    // FAST PATH: a pinned class IRI skips the network probe entirely.
    if (this.classIri) {
      const entry = resolveComponentForClass(this.classIri, { mode: this.mode });
      this.#applyResolution(token, entry);
      return;
    }

    this.status = "loading";
    this.errorMessage = "";

    const seam: DataSeam = {
      ...(this.fetch ? { fetch: this.fetch } : {}),
      ...(this.publicFetch ? { publicFetch: this.publicFetch } : {}),
    };
    const controller = new DataController(seam);

    try {
      const result = await controller.read(src, this.publicRead ? { public: true } : {});
      if (token !== this.#token) return; // superseded.
      const types = result.dataset ? collectTypes(result.dataset) : new Set<string>();
      const entry = resolveComponent(types, { mode: this.mode });
      this.#applyResolution(token, entry, types);
    } catch (error) {
      if (token !== this.#token) return;
      this.resolved = undefined;
      this.errorMessage =
        error instanceof DataControllerError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      this.status = "error";
    }
  }

  /** Apply a resolution: lazy-load + mount the element, or fall back to unsupported. */
  #applyResolution(token: number, entry: ComponentEntry | undefined, types?: Set<string>): void {
    if (token !== this.#token) return;
    if (entry) {
      this.resolved = entry;
      this.status = "ready";
      // The element module is registered as a side effect of importing the package
      // root (every component self-registers; the barrel imports them). We are
      // already loaded (this module is part of that barrel), so the tag is defined —
      // but we still ensure the import resolves for a tree-shaken/lazy consumer.
      void this.#ensureRegistered(entry.importSpec, token);
      return;
    }
    // No typed element. If the resource is an LDP container, render the generic
    // listing; otherwise there is no view for it in Phase-1.
    const isContainer =
      types !== undefined && (types.has(LDP_CONTAINER) || types.has(LDP_BASIC_CONTAINER));
    if (isContainer) {
      this.resolved = resolveComponentForClass(LDP_CONTAINER, { mode: this.mode });
      this.status = this.resolved ? "ready" : "unsupported";
      return;
    }
    this.resolved = undefined;
    this.status = "unsupported";
  }

  /** Lazy-import the element's module so its `customElements.define` has run. */
  async #ensureRegistered(importSpec: string, token: number): Promise<void> {
    if (customElements.get(this.resolved?.tagName ?? "")) return;
    try {
      await import(/* @vite-ignore */ importSpec);
    } catch (error) {
      if (token !== this.#token) return;
      this.errorMessage = `Failed to load the view module "${importSpec}": ${
        error instanceof Error ? error.message : String(error)
      }`;
      this.status = "error";
    }
  }

  protected override render(): TemplateResult {
    switch (this.status) {
      case "idle":
        return html`<slot name="empty"><p part="empty">No resource to display.</p></slot>`;
      case "loading":
        return html`<slot name="loading"><p part="loading">Loading…</p></slot>`;
      case "error":
        return html`<p part="error" role="alert">${this.errorMessage}</p>`;
      case "unsupported":
        return html`<slot name="unsupported"
          ><p part="unsupported">No typed view is available for this resource.</p></slot
        >`;
      default:
        return this.#renderResolved();
    }
  }

  /** Mount the resolved child element, forwarding the seam + src as properties. */
  #renderResolved(): TemplateResult {
    const entry = this.resolved;
    if (!entry) return html`<p part="unsupported">No typed view is available.</p>`;
    // Create the element imperatively so we can set OBJECT properties (the fetch
    // seam) — attributes can only carry strings. The tag is registered (we imported
    // its module). We render a placeholder host and populate it in updated().
    return html`<div part="host" data-tag=${entry.tagName} data-src=${this.src ?? ""}></div>`;
  }

  /**
   * After render, (re)mount the resolved child with the seam + src wired as
   * properties. Done in `updated` (not the template) so the OBJECT props (`fetch`,
   * `publicFetch`) are set on the element instance, which a string attribute can't do.
   */
  protected override updated(_changed: PropertyValues<this>): void {
    const host = this.querySelector('[part="host"]') as HTMLElement | null;
    if (!host || !this.resolved) return;
    const tag = this.resolved.tagName;
    let child = host.firstElementChild as HTMLElement | null;
    // Recreate the child if it is missing or is the wrong tag (a resolution change).
    if (!child || child.tagName.toLowerCase() !== tag) {
      host.replaceChildren();
      child = document.createElement(tag);
      host.append(child);
    }
    // Forward the seam + src as PROPERTIES (the child elements read these props).
    const c = child as unknown as {
      fetch?: typeof fetch;
      publicFetch?: typeof fetch;
      publicRead?: boolean;
      src?: string;
    };
    c.fetch = this.fetch;
    c.publicFetch = this.publicFetch;
    c.publicRead = this.publicRead;
    c.src = this.src;
  }
}

if (!customElements.get("solid-view")) {
  customElements.define("solid-view", SolidView);
}

declare global {
  interface HTMLElementTagNameMap {
    "solid-view": SolidView;
  }
}
