<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

## Tailwind v4: a host app's UNLAYERED global rule out-ranks ALL your `@layer`'d utilities

A shared component library (an app shell consumed by many apps) cannot assume the host's global CSS
leaves its controls alone. In Tailwind v4 utilities live in `@layer utilities`, and an author rule
that is **unlayered** — a bare `button {}` / `input {}` in the app's CSS, outside any `@layer` —
beats **every** `@layer`'d rule in the cascade, regardless of specificity or source order (unlayered
author styles always win over layered ones). So a host app's plain `button { background; border;
color }` repaints your shell's buttons, and **`@layer`'ing your component CSS or bumping specificity
does NOT fix it** — a layered rule loses to an unlayered one no matter how specific.

Two defenses that actually make a library immune to arbitrary host global CSS:

- **Ship an unlayered, attribute-scoped defensive reset.** Mark your controls with a data attribute
  and write an **unlayered** `[data-app-shell-control] {…}` rule. An attribute selector (specificity
  0,1,0) beats a bare element selector (0,0,1) **when both are unlayered**, so your controls keep
  their look against any host `button {}`. Re-assert the leak-prone visuals there (fill/border/text
  per variant, the `:focus-visible` ring). Give consumers an escape hatch (a prop to opt a control
  out) so they can still restyle it.
- **Isolate design tokens with a library-private mirror of LITERAL values, not `var()` indirection.**
  A token that resolves `var(--accent)` re-reads the consumer's `:root` at use-time, so a host
  re-aliasing `--accent` still clobbers you. Hold literal values in private names instead
  (`--as-accent: #4f46e5`). Declare that private mirror on a **shared ancestor that portaled content
  also inherits from** — a `:root`/host-element scope (or a class on a stable ancestor), NOT only on
  the control selector: CSS custom properties inherit down the DOM **subtree** only, so a token
  declared on `[data-app-shell-control]` won't reach a dropdown/dialog **portaled outside** that
  subtree. (Alternatively, stamp portaled roots with the same data attribute.) A `:root`-scoped
  private literal both reaches portals and resists the consumer-override that `var()` indirection
  suffers.

```css
/* The private LITERAL mirror lives on a shared ancestor (`:root`/host) so
   portaled menus/dialogs inherit it — NOT `var(--accent)` indirection. */
:root { --as-accent: #4f46e5; }

/* UNLAYERED (outside any @layer) so a host's bare `button {}` can't beat it.
   Attribute selector (0,1,0) > element selector (0,0,1) when both are unlayered. */
[data-app-shell-control] {
  background: var(--as-accent);
  border: 1px solid var(--as-accent);
  color: #fff;
}
[data-app-shell-control]:focus-visible { outline: 2px solid var(--as-accent); }
```

(Learned building [`@jeswr/app-shell`](../../../packages/app-shell/README.md), 2026-06-17 — a consuming
app's unlayered `button {}` repainted the shell's controls and `@layer`/specificity bumps didn't fix
it; an unlayered attribute-scoped reset + a private literal token mirror did.)

## Apply theme in an isomorphic layout effect, not a passive `useEffect`, to kill the first-frame flash

A `ThemeProvider` that resolves + applies the theme (and adopts the stored preference) in a passive
`useEffect` runs **after paint**: for a dark-OS `system` user, `resolvedTheme` starts `"light"` and
is corrected only after the first frame — a one-frame light flash for any content rendered off
`resolvedTheme`. An inline pre-hydration `<script>` that toggles the `.dark` **class** does NOT fix
the React **state** that content reads.

**Fix: apply via an isomorphic layout effect** — `useLayoutEffect` in the browser, `useEffect`
off-browser (a `typeof window` guard) — so `resolvedTheme` and the `.dark` class are correct on the
**first painted frame**. It's SSR-safe: a no-op off-browser, and the first render still uses the
SSR-stable default so there's no hydration mismatch. Generalises to any light/dark/system theme
provider.

```ts
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

useIsomorphicLayoutEffect(() => {
  const resolved = preference === "system" ? systemPrefersDark() ? "dark" : "light" : preference;
  setResolvedTheme(resolved);                                  // correct on the first PAINTED frame
  document.documentElement.classList.toggle("dark", resolved === "dark");
}, [preference]);
```

(Learned building [`@jeswr/app-shell`](../../../packages/app-shell/README.md), 2026-06-17 — a
`ThemeProvider` applying the theme in a passive `useEffect` flashed light for one frame for dark-OS
`system` users.)

## `@lit/react` drops a custom element's reactive PROPERTY under React 19 unless it reflects to an attribute

When a framework-agnostic Web-Components chrome library (Lit) ships a React adapter via `@lit/react`'s
`createComponent`, the wrapper classifies each prop **at component-creation time** — *before* the Lit
element class is finalized. A Lit reactive **property** that is NOT reflected to an attribute can then
be **silently dropped** when set through the React wrapper under React 19: the property never reaches
the element, so it renders its fallback (e.g. a `<jeswr-loading label="Signing you in…">` shows the
generic "Loading"). It looks like the prop "didn't take" with no error.

Three fixes, in order of preference:

- **(a) Make the element's string props `reflect: true`** (declare them as attributes) so a real
  browser forwards them as attributes — the durable fix, in the library. (But `reflect: true` does
  **not** make the prop reach the element under `@lit/react`'s React wrapper in **vitest/jsdom** —
  see the test caveat below.)
- **(b) Until then, consume via the RAW custom element with a DOM attribute**, not the React-wrapper
  property: `<jeswr-loading label="Signing you in…">` rather than the wrapped `<Loading label=…>`.
- **(c) In unit tests, drive the RAW custom element and assert via the rendered shadow root /
  `::part` / the reflected attribute (`reflect: true`) / `aria-label` — NOT the raw property and NOT
  a React-wrapper assertion** — and validate real prop-forwarding in a browser.

```tsx
// (a) library-side: a reflected property is forwarded by @lit/react in a real browser
@property({ type: String, reflect: true }) label = "Loading";

// (b) consumer workaround until (a) lands — raw element + DOM attribute, not the wrapper property
<jeswr-loading label="Signing you in…" />

// (c) test against the RAW element's rendered DOM, not the React wrapper and not the property
//     (cast: createElement returns HTMLElement — use the exported element type if you have it)
const el = document.createElement("jeswr-loading") as HTMLElement & { label: string; updateComplete: Promise<unknown> };
el.label = "Signing you in…"; document.body.append(el);
await el.updateComplete;
expect(el.getAttribute("label")).toBe("Signing you in…");                               // reflected attribute
expect(el.shadowRoot!.querySelector('[part="label"]')!.textContent).toBe("Signing you in…"); // shadow part
// NOT: render(<Loading label="Signing you in…"/>) then assert the label — it won't reach the element in vitest
```

**Why a React-wrapper assertion can't pass in vitest (clarifies fix (a)): the wrapper's
prop-forwarding effect is compiled OUT under the `node` export condition.** `@lit/react`'s
`createComponent` forwards reactive props to the element in a `useLayoutEffect` (its `NODE_MODE`
build). Under vitest/jsdom, `@lit/react` resolves its package's **`node`** export condition, whose
build **skips that property-forwarding effect** — so `render(<Loading label="…"/>)` then asserting
the rendered label **cannot pass in vitest even with `reflect: true`**: the prop simply never reaches
the element. This is an **environment artifact, not a component bug** (it works in a real browser).
So `reflect: true` is necessary for attribute-based consumption, but it does **not** make the
`<Wrapper prop>` render under the wrapper in vitest — assert the contract on the **raw element**
(set the property directly, then check the reflected attribute + the rendered `::part`).

(Learned adopting [`@jeswr/solid-elements`](../../../packages/solid-elements/README.md) across the vite
pod-apps, 2026-06-17 — a `Loading` label set via the `@lit/react` wrapper was dropped under React 19
and the spinner showed the generic fallback; reflecting the prop / using the raw element + DOM
attribute fixed it. The vitest `node`-condition caveat came from the same pod-mail/pod-money safe-form
back-port — a React-wrapper label assertion couldn't pass under vitest's `NODE_MODE` build no matter
what, until the test was rewritten to drive the raw element + assert the reflected attribute/part.)

## A shared chrome library that isolates COLOR but not the BOX MODEL: keep host element rules SCOPED

A shared React/WC chrome library (like [`@jeswr/app-shell`](../../../packages/app-shell/README.md)) may
isolate its controls' **color / border / fill** via an unlayered attribute-scoped reset
(`[data-app-shell-control]`, see the Tailwind-v4 section above) + private design tokens — but
deliberately leave the **box model** (padding / border-radius / font-size) to its own *layered*
utility classes, so consumers can size things. The consequence on the consuming side: a consumer
app's **bare unlayered global `button {}`** that sets box-model props will still out-rank the
library's *layered* sizing (unlayered beats layered) and **distort the shared controls** — squashed
padding, wrong radius — even though their color survives. The reset isolates color, not the box model.

**Fix — on the CONSUMER: keep host element base rules SCOPED, and only globally relax what the reset
actually covers.** Scope your global element rules so they don't reach the library's controls (a
container class, or excluding the controls' marker attribute), and reserve any *global* element rule
for the parts the reset owns (e.g. re-aliasing a design token), not the box model the library lays
out:

```css
/* WRONG: a bare unlayered global rule out-ranks the library's layered sizing and squashes its controls */
button { padding: 4px 8px; border-radius: 2px; font-size: 13px; }

/* RIGHT: scope host element rules so the shared controls are left to size themselves */
.login-form button { padding: 4px 8px; border-radius: 2px; }      /* container-scoped */
button:where(:not([data-app-shell-control])) { padding: 4px 8px; } /* or exclude the controls — :where() keeps it (0,0,1) */
```

**The exclusion-selector trap (important): wrap the `:not()` in `:where()`, never use a bare
`:not([attr])`.** A bare `:not([data-app-shell-control])` **leaks the attribute selector's
specificity through `:not()`** — it raises the rule from a plain element's `(0,0,1)` to `(0,1,1)`.
That now out-ranks your own *class-only* host-button overrides (`.foo-link`, `.foo-cancel`, the
transparent/outline buttons at `(0,1,0)`) and **repaints them with the base look** — a real visual
regression, not a near-miss. `:where(:not(…))` carries **zero** specificity, so the base stays
`(0,0,1)` — identical to a bare `button {}` — your class-only overrides win again, and the library's
controls are still excluded. Guard it at source: a test that rejects **both** the unscoped global
form and the bare-`:not()` form.

```css
/* WRONG too: a bare :not([attr]) leaks specificity → (0,1,1), out-ranks your own .foo-link/.foo-cancel (0,1,0) */
button:not([data-app-shell-control]) { … }
/* RIGHT: :where() zeroes it → (0,0,1), your class-only overrides still win */
button:where(:not([data-app-shell-control])) { … }
```

The rule of thumb: **a chrome library can isolate color cheaply (a reset re-asserts a few literal
visuals) but cannot defend its box model without owning your layout** — so the box model stays a
shared contract, and the consumer keeps its global element styling off the library's controls (and
keeps that global rule at element specificity via `:where()`).

(Learned adopting [`@jeswr/solid-elements`](../../../packages/solid-elements/README.md) across the vite
pod-apps, 2026-06-17 — `@jeswr/app-shell`'s reset isolated the controls' color but not their box
model, so a consuming app's unlayered global `button {}` distorted the shared controls until the
host's element rules were scoped. The `:where()`-vs-bare-`:not()` specificity-leak refinement came
from the pod-mail/pod-money back-port of that safe form, where the bare `button:not([…])` exclusion
was reviewer-flagged Medium for raising the base button to `(0,1,1)` and silently repainting the
apps' own class-only link/cancel buttons; pod-docs landed the `:where(:not(…))` fix.)

## Consuming `@jeswr/app-shell` on a Tailwind-v4 app while keeping YOUR OWN palette

`@jeswr/app-shell` ships its own suite theme tokens (the `--as-*` design tokens above). An app
that has its **own** brand palette doesn't want the suite colours — it wants the shell's *chrome*
(`ThemeProvider`/`ThemeToggle`, `AccountMenu`, `FeedbackButton`) to render in **its** colours.
The recipe that worked across the portfolio apps, without forking the shell:

- **Alias the shell-private `--as-*` tokens onto the app's own palette**, declared on **both**
  `:root` and `.dark` so the shell's controls track your light/dark scheme. You re-point the
  shell's private literals at *your* values rather than adopting its defaults:

  ```css
  :root      { --as-accent: var(--my-brand-600); --as-bg: var(--my-bg);  --as-fg: var(--my-fg); }
  .dark      { --as-accent: var(--my-brand-400); --as-bg: var(--my-bg-dark); --as-fg: var(--my-fg-dark); }
  ```

- **Register the `as-*` keys in your Tailwind v4 `@theme` + make the `dark:` variant CLASS-driven**
  so your utility classes can reference the same tokens and the shell's `ThemeProvider` (which toggles
  the `.dark` **class**, see the isomorphic-layout-effect section) drives both the shell's chrome and
  your app's dark variants from one switch. In Tailwind v4's CSS-first setup the `dark:` variant is
  **media-driven by default** — you must opt into class-driven dark mode with the CSS-native
  `@custom-variant` (otherwise `dark:` utilities ignore the `.dark` class the shell toggles, so your
  app and the shell's chrome disagree on dark mode):

  ```css
  /* CSS-first (v4-native): register the tokens AND make `dark:` follow the `.dark` class */
  @custom-variant dark (&:where(.dark, .dark *));
  @theme {
    --color-as-accent: var(--as-accent);
    --color-as-bg: var(--as-bg);
    --color-as-fg: var(--as-fg);
  }
  ```

  (If your project drives Tailwind from a JS config instead, set `darkMode: "class"` there and load
  it via `@config "../tailwind.config.js";` — a bare JS config is **not** picked up automatically in
  v4's CSS-first mode, so the `dark:` variant would silently stay media-driven.)

- **Import ONLY the shell's reset, not its suite theme tokens.** Pull in the unlayered
  attribute-scoped reset (`[data-app-shell-control]`) that keeps the controls immune to your global
  CSS — but do **not** import the shell's suite-palette token sheet, or it re-declares `--as-*` with
  the suite colours and overrides your aliases. Import the reset stylesheet; alias the tokens
  yourself. (The shell exposes the reset separately precisely so a consumer can keep its own palette.)

The mental model: `@jeswr/app-shell` is the *theme-truth + RDF/stateful home* and the
`--as-*` tokens are its **public theming seam** — a consumer keeps its own look by **re-pointing
that seam at its palette** (`:root`/`.dark` aliases + the Tailwind theme keys + `darkMode:'class'`),
taking the shell's reset for control-isolation but not its colour values. This pairs with the
Tailwind-v4 defensive-reset section above (that's the library defending its controls; this is the
consumer steering the controls to its own colours through the same token seam).

(Learned in the @jeswr money-making-portfolio build — AccessRadar/Keystone/CapNote/Provena/Furlong,
2026-06: consuming `@jeswr/app-shell` on Tailwind-v4 apps that each kept a distinct brand palette by
aliasing the `--as-*` seam onto their own colours rather than adopting the suite theme.)
