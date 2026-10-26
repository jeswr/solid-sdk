<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/suite-ui

Normative tokens from `01-design-system` §2.1–2.7 and Amendment 2026-10-25. Import `styles/tokens.css`,
`styles/theme.css` (Tailwind v4), and `styles/density.css`. Set `.dark` for dark
mode and `data-density="comfortable|compact"` for density. Coarse pointers force
comfortable rows and 44px controls. Reduced motion zeros motion durations.

`tokens` exports the typed inventory, including both themes and compact values.
`fonts` exports `onest`, `sourceSerif`, and `sourceCode` for Next.js root layouts;
apply their `.variable` classes to `<html>` so the `:root` font aliases resolve.
The default entry has no Next.js runtime import.

The frozen `test/spec-tokens.json` is the spec transcription; the snapshot and CSS
parity test guard changes. Run `pnpm check:tokens` and `pnpm check:contrast` at the
workspace root. `--input` supplies form control boundaries with at least 3:1 contrast
against `--background` and `--surface` in both themes. `--border-strong` remains
the decorative border token. Warning text on `--warning` meets 4.5:1 in both themes.

DS-12 adds `TypedView`, `DetailsPane`, and `PodMeter`. Import `styles/components.css`
after the token styles. `TypedView` accepts a `TypedViewData` projection from typed RDF
accessors; its registry maps RDF class IRIs to renderers and can be extended with a
caller-owned map. The suite app's `src/components/typed-view-data.ts` supplies the adapter.
Technical serialization is rendered only when `showTechnicalDetails` is true, inside a
native disclosure. Bind that prop to Settings › Advanced, never to the resource itself.

`DetailsPane` accepts metadata, an actions slot, and the structural result of
`share.get`. Pass `ownerId` to exclude the owner from the people count, resolved names
in `people`, and `onManageAccess` to open the consuming screen's share dialog. The
consumer hosts the pane in its responsive sheet and owns loading, refresh and errors.
`PodMeter` takes usage in bytes and an optional quota; absent quota never implies a
percentage. All three accept `SurfaceState` for loading, empty and classified errors.
