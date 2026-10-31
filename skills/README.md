<!-- AUTHORED-BY Codex GPT-6.1-Sol -->

# Agent skills

[INDEX.md](INDEX.md) lists the shared skills in this directory and the package skills
colocated at `packages/<package>/SKILL.md`. Repository workflows marked with
`metadata.internal: true` stay in this checkout and are excluded from sync.

## Sync to Claude Code and Codex

Run from the repository root with Node 24 or later:

```sh
node scripts/skills-sync.mjs
node scripts/skills-sync.mjs --target claude
node scripts/skills-sync.mjs --target codex --link
```

These commands only print a plan. The default target is `both`: `~/.claude/skills/`
and `~/.codex/skills/`. Each plan entry is `add`, `update`, `remove`, or
`skip-foreign`; unchanged owned skills are omitted. Shared skills install under
their skill name; package skills use the package name without its scope.

`--apply` writes the plan. `--link` installs directory symlinks to this checkout
instead of copies, so the checkout must remain available. Copy mode includes the
whole shared skill directory; package copies include `SKILL.md` and any
`references/`, `scripts/`, and `assets/` companions, excluding package implementation
and dependencies. Package links point to the package directory. Links in skill
text that refer outside the copied payload still require the checkout.

Each target owns only the names recorded in its `.solid-skills-manifest.json`
(name → SHA-256 source payload hash). Unrecorded directories, files, and symlinks,
including skills linked from `~/.agents/skills/`, are reported as `skip-foreign`
and left alone. `--adopt` explicitly takes ownership of matching foreign names;
unrelated foreign skills remain untouched.

Before updating or removing an existing owned skill, or adopting a foreign skill,
the script copies it into that target's sibling
`skills.bak/<timestamp>/<name>` directory, for example
`~/.claude/skills.bak/<timestamp>/solid-auth/` or
`~/.codex/skills.bak/<timestamp>/solid-auth/`. Backed-up symlinks retain their
original targets; their target directories are never copied or removed. Local
edits to owned copies trigger an update and are preserved in the backup. Removing
a source skill, or marking it internal, removes only its owned installations.
Changing between copy and link mode also backs up the previous installation.

Use `--home <directory>` to select an isolated home for testing. All automated
apply-mode tests use temporary homes. **Do not run `--apply` against the real home
until Jesse has reviewed the PR.** A disposable manual check can use:

```sh
test_home=$(mktemp -d)
node scripts/skills-sync.mjs --home "$test_home"
node scripts/skills-sync.mjs --home "$test_home" --apply
```

Run the regression tests with `pnpm exec vitest run test/skills-sync.test.mjs`.
Malformed ownership manifests and symlinked target, backup, or manifest paths are
rejected before either target is changed.
