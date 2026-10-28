<!-- AUTHORED-BY Codex GPT-6 -->

# App hosting

The [Pages workflow](../.github/workflows/pages.yml) builds one static site on pushes
to `main` that touch apps, packages, the lockfile or deployment tooling. It also supports
manual runs; only `main` can publish. Each app has its own base path and client identity.

| App | Source | Hosting URL |
| --- | --- | --- |
| Pod Drive | `apps/pod-drive/web` | https://jeswr.github.io/solid-sdk/pod-drive/ |
| Pod Docs | `apps/pod-docs/web` | https://jeswr.github.io/solid-sdk/pod-docs/ |
| Pod Chat | `apps/pod-chat/web` | https://jeswr.github.io/solid-sdk/pod-chat/ |
| Pod Mail | `apps/pod-mail/web` | https://jeswr.github.io/solid-sdk/pod-mail/ |
| Pod Photos | `apps/pod-photos/web` | https://jeswr.github.io/solid-sdk/pod-photos/ |
| Pod Music | `apps/pod-music/web` | https://jeswr.github.io/solid-sdk/pod-music/ |
| Pod Money | `apps/pod-money/web` | https://jeswr.github.io/solid-sdk/pod-money/ |
| Pod Health | `apps/pod-health/web` | https://jeswr.github.io/solid-sdk/pod-health/ |
| App Store | `apps/app-store/web` | https://jeswr.github.io/solid-sdk/app-store/ |
| Access Manager | `apps/access-manager` | https://jeswr.github.io/solid-sdk/access-manager/ |
| Solid Suite | `apps/suite` | Vercel project `solid-suite`, `main` only |
| Pod Manager | `apps/pod-manager` | Next.js; Vercel git deployments disabled |
| Issues | `apps/issues` | Next.js; Vercel git deployments disabled |
| Coeliac | `apps/coeliac` | Next.js; Vercel git deployments disabled |

Pod Manager, Issues and Coeliac retain any existing deployment until separately replaced;
they are not included in the static Pages artifact. The future `solid-pod-migrator`
project (`apps/pod-migrator`, not yet on `main`) must also disable git deployments.
The Vercel guard checks app configs independently of the deployment inventory.

In repository **Settings → Pages → Build and deployment**, set **Source = GitHub Actions**.
The workflow uses the `github-pages` environment and the Pages artifact/deployment actions;
see [GitHub's custom-workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
GitHub Actions must be enabled and able to run for the site to publish.

All non-suite Vercel configs set `git.deploymentEnabled: false`. Suite uses
`{ "**": false, "main": true }` and retains its dependency-aware ignored-build step.
The globstar covers branch names containing `/`; unspecified branches default to enabled in
[Vercel's git configuration](https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled).

## Building locally

Use Node 24 and the same entry point as the workflow:

```sh
export PATH=/opt/node24/bin:$PATH
pnpm install --frozen-lockfile
APP_ORIGIN=https://jeswr.github.io node scripts/build-pages.mjs
```

To build a subset for inspection, pass slugs, for example
`APP_ORIGIN=https://jeswr.github.io node scripts/build-pages.mjs pod-drive access-manager`.
This first builds workspace dependencies, then runs each app's build script with
`--base /solid-sdk/<slug>/` and `CLIENT_BASE_PATH=/solid-sdk/<slug>/`.
`APP_ORIGIN` supplies the origin of the generated client document and popup callback;
`CLIENT_BASE_PATH` supplies its path. The latter defaults to `/`, preserving local
and domain-root builds. Browser auth URLs use Vite's `import.meta.env.BASE_URL`.

The assembled `.pages/` directory contains each app's assets, `clientid.jsonld`,
callback, and a `404.html` copy of its entry point, plus an app index at the site root.
Because Pages uses a site-wide error page, the root `404.html` selects the app shell
from the first path segment without changing the requested URL, OAuth query or hash.
