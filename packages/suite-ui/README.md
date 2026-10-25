<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# @jeswr/suite-ui

Normative tokens from `01-design-system` §2.1–2.7. Import `styles/tokens.css`,
`styles/theme.css` (Tailwind v4), and `styles/density.css`. Set `.dark` for dark
mode and `data-density="comfortable|compact"` for density. Coarse pointers force
comfortable rows and 44px controls. Reduced motion zeros motion durations.

`tokens` exports the typed inventory, including both themes and compact values.
`fonts` exports `onest`, `sourceSerif`, and `sourceCode` for Next.js root layouts;
apply their `.variable` classes to the body. The default entry has no Next.js runtime import.

The frozen `test/spec-tokens.json` is the spec transcription; the snapshot and CSS
parity test guard changes. Run `pnpm check:tokens` and `pnpm check:contrast` at the
workspace root. Known spec contrast issues are enumerated in `QUESTIONS.md`.
