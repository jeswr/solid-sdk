<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Cross-app interop on a shared pod — a consumer must map EVERY producer's `forClass`

Suite apps interoperate by reading and writing the **same pod resources**, discovered through the
**Type Index** (see the [`solid-type-index`](../../solid-type-index/SKILL.md)
skill for the registration/lookup mechanics). A *producer* app registers its container with
`solid:instanceContainer` and stamps it with its primary class via `solid:forClass`; a *consumer*
app — a pod manager, dashboard, or any "browse my data" view — discovers that data by matching those
`forClass` IRIs into its own categories/views. No shared paths, no app-to-app coupling: the class
IRI is the contract.

**THE TRAP (a real finding, cross-app interop test 2026-06-16 across
[`jeswr/pod-docs`](../../../apps/pod-docs/README.md), [`jeswr/pod-chat`](../../../apps/pod-chat/README.md),
and the Pod Manager on one shared pod):** a consumer must map *every* producer's registered
`forClass` IRI into its own category/view map — otherwise the producer's data is **still discovered**
(it shows up) but lands in a generic "uncategorised / other" bucket instead of the right view.
Concretely, pod-docs registers its documents as `pd:Document` (`https://w3id.org/jeswr/pod-docs#Document`);
the Pod Manager hadn't mapped that IRI, so the docs surfaced under "Other data" until the consumer
added the class to its Documents category. The data was never lost — just mis-bucketed — which makes
this easy to miss in a quick look (the app "works", it's just in the wrong place).

So, two standing rules when you **add a producer app** to a suite that shares a pod:

1. **Add its registered class(es) to the consumer's category/view map** in the same change — and
   include both `https://schema.org/` and legacy `http://schema.org/` forms where the producer might
   stamp either (pods in the wild use both). For an interim/placeholder namespace
   (`https://TBD.example/…` pending a frozen vocab base), keep the consumer's map in sync with the
   producer's vocab module and leave a comment so the freeze updates both.
2. **Cover each mapping with a regression test** — assert each producer's primary `forClass` resolves
   to its expected category and is NOT the fallback bucket, so a future edit that drops a mapping
   fails loudly instead of silently re-bucketing that app's data into "Other".

**The interop-friendly resource shape** that worked across all the suite apps: **one resource per
item**, Turtle, with a **stable fragment subject** (`<#it>` / a per-item `#…` IRI, not a bare `<>`),
typed with **standard vocabs** — schema.org, ActivityStreams (`as:Note`), or a domain ontology — and
**registered per-container in the Type Index** (`solid:instanceContainer` + `solid:forClass`). A
stable fragment subject lets other apps and the consumer reference the item by a durable IRI across
edits; standard vocabs are what make the `forClass` match work without bilateral agreement.

## A prebuild config generator must load `.env` itself — and resolve precedence PER-LAYER

A per-origin host shell often runs a **prebuild script** to emit build-time config — most commonly a
per-subdomain Client Identifier Document (`clientid.jsonld`, see the `solid-client-id` skill), whose
served URL *is* the `client_id`, so a wrong origin = broken login at the deployed subdomain. Two traps,
both real (cited:
[`jeswr/pod-photos@bd490ac`](https://github.com/jeswr/pod-photos/commit/bd490ac),
[`jeswr/pod-music@2c3dcb3`](https://github.com/jeswr/pod-music/commit/2c3dcb3)):

- **A script that runs BEFORE the bundler does not get the bundler's `.env` loading.** Vite (etc.) loads
  `.env`/`.env.local` for *your app code*, not for a Node script you run in a prebuild step — so reading
  only `process.env` means a plain `npm run build` (no shell var set) silently bakes the **localhost/dev**
  origin into the production document, even though `.env.example` claims those files drive it. Load them
  yourself: `parseEnv` from `node:util` (zero deps; needs Node ≥ 20.12) over `.env` then `.env.local`.
- **Resolve the origin PER-LAYER, in strict priority — do NOT merge the files into one dict.** Order:
  `shell (non-empty) → .env.local → .env → dev-default`; each layer picks its *own* origin var (e.g.
  `APP_ORIGIN`, else `VITE_APP_ORIGIN`), and the **first layer that yields one wins**. Merging the two
  files into a single dict and then picking per-variable (`merged.APP_ORIGIN ?? merged.VITE_APP_ORIGIN`)
  is **wrong**: if `.env` sets `APP_ORIGIN` and `.env.local` sets the *other* var (`VITE_APP_ORIGIN`),
  the merged dict keeps both keys and the `APP_ORIGIN`-first pick returns the `.env` value — so `.env`
  beats `.env.local` cross-variable, and `.env.local` fails to fully override `.env`. Per-layer
  resolution avoids that. (Treat an **empty** shell var `APP_ORIGIN=` as *absent*, so it doesn't suppress
  a file value.)
- **Guard the file-writing `main()` behind a realpath `isInvokedDirectly()` check** (compare
  `realpathSync(process.argv[1])` to this module's `realpathSync(fileURLToPath(import.meta.url))`), and
  export the pure resolver — so the precedence logic is **unit-test-importable side-effect-free** (no
  filesystem write, no `process.env` read) while still running on direct invocation.

## Never call a throwing typed setter from a controlled input's `onChange`

A controlled (live-edit) React text input wired **directly** to a typed model setter that
**validates by throwing** is a recurring footgun. Typed RDF accessors (`@solid/object` /
`@rdfjs/wrapper` `…As` setters, see the [`solid-object`](../../solid-object/SKILL.md)
skill) throw on invalid input — and **every intermediate keystroke is transiently invalid**: the
empty string mid-edit, a duplicate-while-retyping, a half-typed value. So `onChange={(e) =>
model.statusName = e.target.value}` throws the moment the field is blank and breaks the editor.

**Pattern: store raw, validate separately, set only valid.** The controlled input writes the **raw**
string into local component state and **never throws in `onChange`**. Validation runs separately —
over the assembled draft — surfaced as a save-blocking validity check / inline error. The throwing
model setter is invoked **only at save time, with an already-valid value:**

```tsx
// onChange NEVER throws — raw string into local state
<input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
// validate the assembled draft separately (save-blocking + inline error)
const error = draft.name.trim() === "" ? "Name required"
  : isDuplicate(draft.name) ? "Name already used" : undefined;
// the throwing typed setter runs ONLY at save, with a valid value
<button disabled={!!error} onClick={() => { model.statusName = draft.name; save(); }}>Save</button>
```

This generalises to ANY Solid app form bound to typed RDF accessors that validate — store-raw-then-
validate, never let a transient mid-edit value reach a throwing setter. (Learned building the
[`jeswr/solid-issues`](../../../apps/issues/README.md) workflow-editor, 2026-06-17 — a
status-rename input wired straight to a throwing typed setter broke on the empty string mid-edit.)
