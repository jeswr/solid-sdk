<!-- AUTHORED-BY Claude Fable 5 -->

# create-solid-demo

Scaffold a **domain-generic multistakeholder pod-data walkthrough**: a pnpm +
Turborepo monorepo whose tour shell renders entirely from ONE JSON walkthrough
document (`@jeswr/solid-showcase`), with a skeleton app per ecosystem seat
(`@jeswr/solid-showcase-kit` trust surfaces + a `@jeswr/solid-pod-guard` sample
authenticated pod route), deterministic seeding (`@jeswr/synthetic-rdf` +
`@jeswr/solid-seed`), disclaimer/axe e2e gates, IRI + insignia lints, and the
deploy playbook.

The framework carries **no use case**: every domain-shaped string enters through
your flags, and the generated `branding.bannedMarks` insignia roster starts
empty for you to fill with your domain's never-render marks.

## Usage

```sh
npx create-solid-demo my-demo \
  --use-case trails \
  --convener "Meridian Trails Collective" \
  --negation "Nothing here is an offer of guided travel." \
  --app vault:"Traveller Vault":"personal data custodian" \
  --app permits:"Permit Desk":"day-permit issuer" \
  --modelled-on permits="Ridgeway Range Authority"
```

(The example is wholly fictional.) Missing required answers are prompted on a
TTY. Flags: `--use-case`, `--convener`, `--negation` (repeatable, ≥1),
`--app slug:name:role` (repeatable, ≥1 — the FIRST app is the data subject's own
custodian seat), `--modelled-on slug=Org`, `--seed`, `--no-install`.

Everything lands in `apps/tour/content/walkthrough.json` — the single document a
team edits afterwards. The placeholder chapters already pass `parseWalkthrough`
and the editorial gates, so the site renders end-to-end before any real content
is written.

## Generated tree (abridged)

```
my-demo/
├── apps/tour/                 # the shell: renders the walkthrough document
│   └── content/walkthrough.json   # THE single edit surface
├── apps/<slug>/               # one skeleton per --app: AppShell + theme +
│                              # interstitial + health route + pod-guard sample route
├── packages/data-model/       # SHACL shapes + vocab stub
├── seeds/                     # deterministic persona seed (synthetic-rdf + solid-seed)
├── e2e/                       # Playwright disclaimers + axe gates
├── scripts/                   # lint-iris.mjs, check-insignia.mjs
└── docs/deploy.md             # env matrix + per-project Vercel gotchas
```

## Development (this package)

The published executable is `dist/bin.mjs`, an esbuild bundle of `src/bin.ts` —
Node does not type-strip inside `node_modules`, so a TS bin would fail under
npx. The build is an EXPLICIT step (`pnpm run build`), never a `prepack` hook:
the suite `.npmrc` sets `ignore-scripts=true`, which would silently drop a
hook-built `dist/` from the tarball. The template's dotfiles ship as rename
shims (`npmrc`→`.npmrc`, `gitignore`→`.gitignore`, `env.example`→`.env.example`,
`github/`→`.github/`) because `npm pack` strips the literals.

`pnpm test` covers args/walkthrough/scaffold plus a real
build → `npm pack` → install → run-the-bin round trip; `RUN_SLOW=1 pnpm test`
additionally scaffolds a repo, resolves the framework deps from packed workspace
tarballs (`pnpm.overrides` `file:` pins — the packages are not yet on npm), and
runs the generated repo's own lint/typecheck/test gates.

See `SKILL.md` for the end-to-end operator flow: scaffold → edit
walkthrough.json → seed → deploy.
