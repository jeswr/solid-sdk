# ADR 0004 — Pod Manager shell vendoring

**Status:** Accepted  
**Date:** 2026-06-15  
**Beads:** pss-5np, pss-0eb, pss-rg3

---

## Context

Solid Issues and the Pod Manager (`solid-pod-manager`) are sibling apps in the suite.
The Pod Manager ships a polished app shell — persistent sidebar on desktop, slide-in drawer
+ bottom bar on mobile, theme toggle, account menu, and a coherent oklch teal palette.
Solid Issues had an ad-hoc top-bar baked into `IssuesView` with its own logo, account
dropdown, and theme buttons.

The maintainer (pss-5np) asked to replace Solid Issues' current shell/theme with the PM's
"sleeker" UI infrastructure while keeping all existing routes and features working inside
the new shell.

## Decision

**Vendor the PM shell into solid-issues** rather than extract a shared package.
Rationale:
- The apps live in separate repos with separate lockfiles and release cycles.
- Solid Issues is a single-SPA; the shared surface is small (7 files).
- Vendoring avoids a new cross-repo dependency and the associated versioning overhead.
- A `vendor-lock.json` + `scripts/check-pm-drift.mjs` drift check replaces the guarantees
  a shared package would give.

### What was vendored

From `solid-pod-manager/src/`:

| Source | Destination | Adaptation |
|--------|-------------|------------|
| `components/app-shell.tsx` | `components/app-shell.tsx` | `useSession` → `useSolidSession`; `"loading"` → `"initialising"`; `Suspense` wrappers for `useSearchParams` |
| `components/sidebar-nav.tsx` | `components/sidebar-nav.tsx` | `isActive` extended to match `?view=` query-param routes |
| `components/brand.tsx` | `components/brand.tsx` | `ShieldCheck + "Pod Manager"` → `CircleDot + "Solid Issues"` (own wordmark, pending pss-70t) |
| `components/account-menu.tsx` | `components/account-menu.tsx` | `useSession` → `useSolidSession`; `profile.displayName` → `profile.name`; no `avatarUrl` on `SolidProfile` |
| `components/theme-toggle.tsx` | `components/theme-toggle.tsx` | Verbatim |
| `components/nav-items.ts` | `components/nav-items.ts` | Replaced with issue-tracker destinations (Issues/Board/Backlog/Epics/Timeline/Calendar/Dashboard/Workload) |
| `components/ui/sheet.tsx` | `components/ui/sheet.tsx` | Verbatim |
| `components/ui/avatar.tsx` | `components/ui/avatar.tsx` | Already present; synced to PM version |

### Palette union (pss-0eb)

`globals.css` was **not replaced** wholesale.  Solid Issues' own indigo/parchment primary
palette (`oklch(0.33 0.08 277)` light, `oklch(0.79 0.09 275)` dark) is retained as the
app's brand voice.  The PM's teal palette blocks were **unioned in** at the token level:

- **Sidebar tokens** (`:root` + `.dark`): replaced the bare-grey defaults with the PM's
  teal-keyed sidebar palette so the shell reads as a coherent PM-family component.
  `--sidebar-primary`/`--sidebar-ring` are pinned to the indigo primary so active nav
  items use Solid Issues' own accent colour (not the PM's teal).
- **Status tokens** (`--success`/`--warning` + foregrounds, both light + dark): added from
  the PM; were absent in solid-issues before.
- **`@layer utilities`** `.measure` and `.tabular`: added from the PM.
- **Motion tokens** and the `@keyframes view-in`/`fade-in` already present in solid-issues
  are preserved (the PM doesn't have them; they're useful for view transitions).

### Shell integration

`layout.tsx` now wraps children in `<AppShell>`, which gates the session:

- `"initialising"` → full-screen spinner
- not `"logged-in"` → `<LoginScreen />`
- `"logged-in"` → sidebar + header + `<main id="main">` wrapping `{children}`

`page.tsx` was simplified to just render `<IssuesView />` (no duplicate auth logic).

`IssuesView` had its ad-hoc `<header>` removed.  The toolbar buttons (Team, Fields,
Automations, Open tracker, Command palette, Share, New issue, ProjectSwitcher) were merged
into the page-heading section inside the component's own `<div>`, visible within the
AppShell's `<main>`.

### Brand default (pss-5np / pending pss-70t)

The `Brand` component uses `CircleDot` + "Solid Issues" by default.  `pss-70t` is a
`needs:user` item for the maintainer to confirm whether to use a suite-unified glyph or
keep the app-specific one.  Changing it requires editing only `src/components/brand.tsx`.

## Drift check

`vendor-lock.json` records the SHA-256 of each PM source file at the time of vendoring.
Run:

```bash
node scripts/check-pm-drift.mjs
# or with an explicit PM path:
node scripts/check-pm-drift.mjs --pm-dir ~/path/to/solid-pod-manager
```

When the script reports drift, review what changed in the PM and apply the relevant delta
to the vendored copy in solid-issues.  Files with deliberate adaptations (noted in
`vendor-lock.json`) will always appear as "drifted" if the PM source changes — that is
intentional; the check is a prompt to review, not a hard gate.

## Consequences

- All eight solid-issues views (list, board, epics, backlog, timeline, calendar, dashboard,
  workload) are accessible via the sidebar and/or `?view=` query param.
- The login screen and session provider are unchanged; `AppShell` delegates to the existing
  `LoginScreen` component.
- `nav-items.ts` is app-specific (not PM nav) — it is listed in `vendor-lock.json` so drift
  checks will fire if the PM's nav shape changes, prompting a structural review.
- New shadcn primitive: `Sheet` (for the mobile drawer) added to `ui/`.
