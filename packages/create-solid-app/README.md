<!-- AUTHORED-BY Codex GPT-5 -->

# create-solid-app

Scaffold a suite-conformant Next.js Solid application from the bundled template.

Generated apps include React 19, Next.js App Router, Tailwind 4, shared shell components, Solid
login plumbing, a local Community Solid Server workflow, tests, and repository guardrails.

> Experimental and private. npm publishing remains blocked on the linked reactive-authentication
> loopback-issuer issue.

## Install

The CLI is not published. Run it from this workspace with Node.js 24:

```sh
pnpm install
node packages/create-solid-app/bin.ts my-app
```

After publication, the intended command is `npx create-solid-app my-app`.

## Minimal usage

```sh
node packages/create-solid-app/bin.ts my-app --repo owner/repository
cd my-app
npm run dev
```

Use `--no-install` to copy without installing dependencies. Use `--seed-pod` to start and seed a
local in-memory Community Solid Server after scaffolding.

## Key CLI

- `create-solid-app <directory>`: copy the template, substitute app metadata, and install.
- `--repo <owner/repo>`: configure the generated feedback target.
- `--data-model <model>`: add a starter view for `solid-view`, `task`, `contact`, `bookmark`,
  `profile`, or `collection`.
- `--no-install`: skip dependency installation.
- `--seed-pod`: start a local development pod and print seeded credentials.
- `-h`, `--help`: show command help.

The command refuses a non-empty destination and copies the committed template lockfile for a
resolution-stable first install.

## Links

- [Source](https://github.com/jeswr/solid-sdk/tree/main/packages/create-solid-app)
- [Reactive authentication issue #18](https://github.com/solid-contrib/reactive-authentication/issues/18)
- [Community Solid Server](https://github.com/CommunitySolidServer/CommunitySolidServer)
- [Solid-OIDC](https://solidproject.org/TR/oidc)

## License

MIT © Jesse Wright
