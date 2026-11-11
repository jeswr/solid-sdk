<!-- AUTHORED-BY Codex GPT-6.1-Sol -->
# Pod Migrator redirect

Pod Migrator has moved into [Solid Suite Settings](https://solid-suite.vercel.app/settings/move-pod).
This private Vite app publishes a short redirect page at the original GitHub Pages entry point.
The migration engine, independent connections, security design and tests live in
[`@jeswr/pod-migrator`](../../packages/pod-migrator/README.md).

`VITE_SUITE_URL` sets the suite deployment URL; it defaults to `https://solid-suite.vercel.app`.
Both the visible link and `location.replace` point to its `/settings/move-pod` section.

```sh
export PATH=/opt/node24/bin:$PATH
pnpm --filter @jeswr/app-pod-migrator build:pages
pnpm --filter @jeswr/app-pod-migrator test
```

`build:pages` retains the `/solid-sdk/pod-migrator/` asset base. Other builds accept
`APP_BASE_PATH`, and the shared Pages builder can override it with `CLIENT_BASE_PATH`.
Build output is uncommitted.
