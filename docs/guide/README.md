<!-- AUTHORED-BY Claude Opus 5.5 -->

# Building Solid apps with the suite SDK

This guide shows you how to build an application that keeps its users' data in their own pod,
using the `@jeswr` packages in this workspace. It assumes you know TypeScript and have built a web
app before. It does not assume you know Solid or RDF.

> **Status.** The SDK is experimental and private to this workspace. Packages are not on npm yet,
> so the guide's examples run inside this monorepo. Parts that do not exist yet are marked
> **Not ready yet** where they come up.

## Chapters

1. [How Solid works](01-how-solid-works.md): pods, WebIDs, resources, RDF, and how the SDK
   fits together.
2. [Your first app: a reading list](02-first-app.md): a small, complete data layer, tested
   against an in-memory pod.
3. [Signing people in](03-sign-in.md): `@jeswr/pod-auth`, the login screen, sessions, and
   server-side agents.
4. [Reading and writing data](04-reading-and-writing.md): `@jeswr/storage-client`, ETags,
   containers, and errors.
5. [Modelling data as RDF](05-modelling-data.md): domain packages, vocabularies, and typed
   accessors.
6. [Live updates, offline and collaboration](06-live-updates-and-offline.md):
   `@jeswr/pod-notifications`, `solid-offline` and `@jeswr/y-solid`.
7. [Sharing and permissions](07-sharing.md): what the SDK supports today and what to do until
   it supports more.
8. [The user interface](08-user-interface.md): the shared shell, components and design rules.
9. [Testing](09-testing.md): memory pods, recorded traffic and a local Solid server.
10. [Shipping](10-shipping.md): the Client Identifier Document, the workspace rules and the gate.

## Status of each part

| Part | Package | State |
| --- | --- | --- |
| Sign-in and sessions | `@jeswr/pod-auth` | Works for Solid-OIDC and LWS; experimental |
| Server discovery | `@jeswr/storage-capabilities` | Works |
| Storage | `@jeswr/storage-client` | Works for Solid and LWS, plus an in-memory pod |
| Change notifications | `@jeswr/pod-notifications` | Works: WebSocket, streaming HTTP, polling |
| Collaborative documents | `@jeswr/y-solid` | Works on Solid; LWS **not ready yet** |
| Shared sign-in screen | `@jeswr/suite-ui/sign-in` (`SignInCard`), `@jeswr/pod-auth/directory` | Ready |
| Sharing | `@jeswr/pod-access` | **Not ready yet**: translation core only |
| React data hooks | `@jeswr/suite-sdk` | **Not ready yet**: planned |
| Type Index, preferences, trash, versions | various | In progress |

## For coding agents

Agents should read the [build-solid-app skill](../../skills/build-solid-app/SKILL.md) first. It
holds the same rules in a compact form and links to every package skill.

## Keeping this guide honest

The tutorial's full code is
[`tools/guide-examples/src/reading-list.ts`](../../tools/guide-examples/src/reading-list.ts) and
its tests run in the workspace gate. Every `ts` code block in these chapters is type-checked
against the packages' public declarations by
[`scripts/check-sdk-skill-examples.mjs`](../../scripts/check-sdk-skill-examples.mjs). If you change
a public API, the gate tells you which page to update.
