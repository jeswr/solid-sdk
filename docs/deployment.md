<!-- AUTHORED-BY Codex GPT-6 -->
<!-- AUTHORED-BY Claude Opus 5.5 -->

# App hosting

The [Pages workflow](../.github/workflows/pages.yml) builds one static site on pushes
to `main` that touch apps, packages, shared build inputs or deployment tooling. It also supports
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
| Solid Suite | `apps/suite` | Vercel project `solid-suite`, deployed from `main` by the vercel-production workflow |
| Pod Manager | `apps/pod-manager` | Next.js; Vercel git deployments disabled |
| Issues | `apps/issues` | Next.js; Vercel git deployments disabled |
| Coeliac | `apps/coeliac` | Next.js; Vercel git deployments disabled |

Pod Manager, Issues and Coeliac retain any existing deployment until separately replaced;
they are not included in the static Pages artifact. The future `solid-pod-migrator`
project (`apps/pod-migrator`, not yet on `main`) must also disable git deployments.
The Vercel guard discovers app directories with a build script or Next/Vite dependency
and requires a disabling config independently of the deployment inventory.

In repository **Settings → Pages → Build and deployment**, set **Source = GitHub Actions**.
The workflow uses the `github-pages` environment and the Pages artifact/deployment actions;
see [GitHub's custom-workflow setup](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
GitHub Actions must be enabled and able to run for the site to publish.

## Vercel deploys

The team is on Vercel's Hobby plan, which allows 100 deployments a day. A Git-linked
project records a deployment for every push, even when the build is skipped, and those
records count. So every Vercel config, the suite's included, sets
`git.deploymentEnabled: false`, the projects are disconnected from Git, and the
[vercel-production workflow](../.github/workflows/vercel-production.yml) is the only thing
that deploys. It deploys the suite only, using `scripts/vercel-production.mjs`:

- It runs on every push to `main` and every 30 minutes, always on the newest `main`.
- It deploys when production serves an older commit, the suite's build inputs changed since
  that commit (the same check as `scripts/vercel-ignore-build.mjs`), and the last deployment
  this workflow made is at least two hours old. That is at most 12 deployments a day.
- A burst of merges therefore produces one deployment. The schedule deploys whatever `main`
  has gathered once the two-hour window reopens, so the newest commit always reaches
  production, even after a quiet day or week.
- It skips while a deployment is building. It does not retry a commit whose deployment
  failed; the next commit, or a forced run, does.
- The build runs on the GitHub runner (`vercel build`) and uploads the output with
  `vercel deploy --prebuilt --prod`, so Vercel build minutes are not used.

Setup needs a Vercel access token for the team in the repository secret `VERCEL_TOKEN`.
Without it the workflow logs a warning and deploys nothing. Run the workflow by hand with
**disconnect_git** once to unlink every project in `scripts/vercel-apps.json` from Git; a
project can be reconnected in its Vercel settings. A manual run with **force** deploys at
once, ignoring the window.

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
Because Pages uses a site-wide error page, the root `404.html` redirects known app routes
to their entry point, encoding the full path, query and hash in `__solid_sdk_path`.
An inline script restores the original URL with `history.replaceState` before the app
router starts. Deep links therefore render only the app shell and retain OAuth returns
and autologin fragments.
