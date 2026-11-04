<!-- AUTHORED-BY Claude Opus 5.5 -->

# 9. Testing

Test in three layers, from fastest to most realistic.

## 1. The data layer on a memory pod

`@jeswr/storage-client/memory` is a complete storage in memory. It enforces the same rules as real
servers: ETags, scoping, paging, and on LWS, server-chosen URLs. Run every data-layer test in both
modes. Code that passes on both is protocol-neutral.

```ts
import { createMemoryStorage } from '@jeswr/storage-client/memory';

for (const protocol of ['solid', 'lws'] as const) {
  const storage = createMemoryStorage({ protocol });
  const created = await storage.create(storage.root, 'hello', { contentType: 'text/plain' });
  console.log(protocol, created.url, (await (await storage.read(created.url)).text()) === 'hello');
}
```

The tutorial's tests,
[`tools/guide-examples/test/reading-list.test.ts`](../../tools/guide-examples/test/reading-list.test.ts),
are a worked example, including a conflicting edit.

Inject everything that touches the outside world, such as `fetch`, clocks and timers, so tests do
not depend on the network or the time of day. `@jeswr/pod-notifications/testing` and
`@jeswr/pod-auth/testing` provide fakes: fake sockets and event sources, a mock OpenID provider,
and a mock LWS authorisation server.

## 2. Recorded server traffic

To test against a real server's exact responses without running it every time, record once and
replay offline with `@jeswr/storage-client/testing`:

- `createRecordingFetch({ fetch, directory })` saves each request and response when `RECORD=1`.
  It strips `Authorization`, `DPoP` and cookie headers.
- `loadFixtures(directory)` and `createReplayFetch(fixtures)` replay them strictly, and
  `assertDone()` fails if a recorded request was not made.

Use a fresh directory per scenario, and read the captured URLs and bodies before you commit them.

## 3. The browser against a local Solid server

For sign-in, the user interface and real HTTP behaviour, run Playwright against a local Community
Solid Server. Never test against live pods. The
[solid-test-infrastructure skill](../../skills/solid-test-infrastructure/SKILL.md) covers how:
start the server once per run, seed fresh accounts with complete profiles, and check that a
"private" read really is private by trying it anonymously first.

When an app works on one server and not another, the
[solid-server-matrix skill](../../skills/solid-server-matrix/SKILL.md) lists the usual differences.

## Seed realistic data

`@jeswr/synthetic-rdf` generates realistic RDF from SHACL shapes, and `@jeswr/solid-seed` writes
it into a pod with a chosen layout. Use them for demos and for screenshots that look like real use.

Next: [shipping](10-shipping.md).
