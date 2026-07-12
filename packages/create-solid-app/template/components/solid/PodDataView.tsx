"use client";
// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// PodDataView — the DECLARATIVE, data-bound example. It renders a pod resource
// through @jeswr/solid-components' read Web Components, with NO hand-rolled LDP
// listing or RDF parsing in this app: a few lines of markup bind a URL + the
// authenticated fetch seam, and the component reads the graph, picks the typed
// view, and renders it.
//
// WHY THIS SHAPE — the load-bearing house rules:
//  1. @jeswr/solid-components are framework-agnostic Lit Web Components (light
//     DOM). They are registered as a side effect of importing the package —
//     `import "@jeswr/solid-components"` runs each module's
//     `customElements.define(...)`. We do that import HERE (a client component),
//     never in a server component, because `customElements` is browser-only.
//  2. They take an INJECTABLE fetch seam (`.fetch` / `.publicFetch`) as object
//     PROPERTIES, not attributes — so we set them through a `ref` callback, the
//     same pattern the suite uses for any Web Component property. We pass the
//     app's authenticated fetch: reactive-authentication's `registerGlobally()`
//     has patched `globalThis.fetch` to attach a DPoP token on a 401, so handing
//     the component `window.fetch` gives it the user's authenticated reads.
//  3. `<solid-view>` is the COMPOSER: it reads the resource's `rdf:type`,
//     resolves the matching typed element (`<jeswr-task-list>` for `wf:Task`,
//     `<jeswr-contact-list>` for `vcard:Individual`, …), and mounts it — falling
//     back to `<jeswr-collection>` (a plain `ldp:contains` listing) for an
//     untyped container. So "render whatever is at this URL" is one element.
//
// READ-ONLY (Phase 1). These components only READ today; the edit/write path
// (an editable SHACL form + edit-mode elements) is @jeswr/solid-components
// Phase 2 — see the package README "Out of scope". When that lands, this view is
// where you would flip a component into edit mode. Until then it is a viewer.
//
// CREDENTIAL BOUNDARY. We pass `.fetch` (the authed, same-origin global) only.
// We deliberately do NOT wire `.publicFetch` here: a public/foreign read is
// fail-closed in the DataController (it throws without an injected credential-
// free fetch rather than leak the DPoP token cross-origin). This example reads
// the signed-in user's OWN pod (their storage root), so the authed seam is all
// it needs. If you add a foreign-origin read, capture a pristine `fetch`
// reference BEFORE `registerGlobally()` patches it and pass it as `.publicFetch`.
import "@jeswr/solid-components";
import { useCallback } from "react";
import { useSolidAuth } from "./SolidAuthProvider";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/** The minimal shape every @jeswr/solid-components read element exposes for the seam. */
interface SeamElement {
  /** The session-bound authenticated fetch (an object property — set via the ref). */
  fetch?: typeof fetch;
}

/**
 * A CALLBACK ref that binds the authenticated fetch onto a @jeswr/solid-components
 * element when it mounts. The seam is an object PROPERTY (`.fetch`), so it is set
 * imperatively — React would otherwise stringify a `fetch` prop as a DOM attribute.
 *
 * Typed `(el: HTMLElement | null) => void`: a callback ref over a supertype is
 * assignable to each element's concrete `Ref<JeswrTaskList | SolidView | …>` (the
 * elements all subclass HTMLElement), so the SAME ref works for whichever bound
 * element the scaffold emits. The patched global fetch is live by the time this
 * runs (the view renders only after login), and carries the user's DPoP token on a
 * protected read.
 */
function useSeamRef(): (el: HTMLElement | null) => void {
  return useCallback((el: HTMLElement | null) => {
    if (el) {
      (el as HTMLElement & SeamElement).fetch = (...args: Parameters<typeof fetch>) =>
        fetch(...args);
    }
  }, []);
}

export function PodDataView() {
  const { webId, profile } = useSolidAuth();
  const seamRef = useSeamRef();
  // The user's first advertised pod storage root (a container) — the source for the
  // default container/list models.
  const storage = profile?.storages[0];

  // THE SOURCE the bound element reads. ONE local, so the readiness guard, the label,
  // and the element `src` always agree. The scaffold swaps this single line per model:
  // a <jeswr-profile-card> reads the WebID profile DOCUMENT (`webId`), every other
  // element reads the pod `storage` container. Keeping it one local is the
  // roborev-round-2 fix — a per-model `src` must not diverge from the guard/label.
  // CSA:DATA-VIEW-SRC:BEGIN — the generator swaps this line for the chosen model
  const dataSrc = storage;
  // CSA:DATA-VIEW-SRC:END

  // Only render once signed in AND we have the resource this model reads.
  if (!webId || !dataSrc) return null;

  return (
    <Card className="w-full max-w-md">
      <CardHeader>
        <CardTitle>Your pod data</CardTitle>
        <CardDescription>
          {/* CSA:DATA-VIEW-DESC:BEGIN — the generator swaps this line for the chosen model */}
          Rendered declaratively with <code>@jeswr/solid-components</code> — it
          reads the resource&apos;s <code>rdf:type</code>, picks the matching
          typed element, and renders it. No hand-rolled LDP or RDF.
          {/* CSA:DATA-VIEW-DESC:END */}{" "}
          Reading <span className="break-all">{dataSrc}</span> (read-only; edit
          mode is coming).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {/* The declarative, data-bound element. `src` is an attribute; `.fetch`
            is an object property set via the ref. The default <solid-view>
            probes rdf:type and mounts the matching element (or <jeswr-collection>
            for an untyped container) — pick a specific model at scaffold time
            with `create-solid-app --data-model <task|contact|bookmark|profile|collection>`.
            Renders into the light DOM, so ::part-styleable. */}
        {/* CSA:DATA-VIEW-EL:BEGIN — the generator swaps this element for the chosen model */}
        <solid-view ref={seamRef} src={dataSrc} part="data-view" />
        {/* CSA:DATA-VIEW-EL:END */}
      </CardContent>
    </Card>
  );
}
