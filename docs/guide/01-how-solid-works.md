<!-- AUTHORED-BY Claude Opus 5.5 -->

# 1. How Solid works

## The idea

In a normal web app, your server holds everyone's data. In a Solid app, each user keeps their
data in a **pod**: web storage they choose and control. Your app asks for permission, reads and
writes the pod over HTTP, and holds no user data of its own. A user can switch apps and keep
their data, or use several apps on the same data.

## The pieces

**WebID.** A URL that names a person, such as `https://id.example/alice#me`. Fetching it gives
a small profile document. The profile lists where the person's pods are and which identity
providers can sign them in.

**Identity provider (issuer).** The service that signs a person in, using Solid-OIDC, a profile
of OpenID Connect. Your app never sees a password. It gets tokens bound to a key that lives in
the browser (DPoP), so a stolen token alone is useless.

**Pod (storage).** A tree of **resources** under a root URL such as `https://pod.example/alice/`.
**Containers** are like folders: they list their members. Any file can be a resource: an image,
a PDF, a JSON file. Structured data is usually RDF.

**RDF.** Data written as statements of the form *subject, predicate, object*, where the names are
URLs. "`<#it>` has title `"Solid explained"`" might be written in Turtle as:

```turtle
<#it> <http://purl.org/dc/terms/title> "Solid explained" .
```

Because names are URLs, two apps that never met can agree on what a "title" or a "task" is. You
rarely write RDF by hand: domain packages do it for you (chapter 5).

**Access control.** Each resource says who can read or write it. Solid servers use WAC (`.acl`
documents) or ACP (`.acr` documents). Chapter 7 covers what the SDK supports.

**Notifications.** A pod can push "this changed" events over WebSocket or streaming HTTP, so
several apps and devices stay in step.

## Solid and LWS

LWS (Linked Web Storage) is the protocol being standardised by the W3C Linked Web Storage
Working Group, building on the Solid Protocol. It keeps the same ideas with different details: the server chooses resource URLs, containers are
paged, permissions are grants rather than ACL files, and storage describes its own features.

You do not need to choose. The SDK discovers which protocol a server speaks and gives you one API
for both. You only have to follow a few rules that are safe on both, and the
[LWS differences skill](../../skills/lws-vs-solid/SKILL.md) lists them. The biggest one: **never
build a resource's URL yourself. Use the URL the server gives you back.**

## How the SDK fits together

```
your app (UI, state, business logic)
   │
   ├── domain models      @jeswr/solid-bookmark, @jeswr/solid-task-model, …
   ├── UI                 @jeswr/app-shell, @jeswr/solid-elements, @jeswr/suite-ui
   │
   ├── @jeswr/pod-notifications   change events
   ├── @jeswr/storage-client      read, list, create, edit, move, delete
   │       └── @jeswr/storage-capabilities   what this server supports
   └── @jeswr/pod-auth            sign-in, sessions, a safe fetch
           │
           ▼
   plumbing: @jeswr/fetch-rdf, @jeswr/rdf-serialize, @jeswr/guarded-fetch, @solid/object, n3
```

Three objects make up an app's data layer:

- **`auth`** from `createPodAuth` signs the user in and gives you `auth.fetch`. That fetch adds
  credentials only to requests for the user's own storage, never to other sites.
- **`storage`** from `createPodClient` is one API over the user's pod, whatever protocol it
  speaks. It needs `auth.fetch`.
- **`notifications`** from `createNotifications` tells you when something in the pod changed.

Apps do not import the protocol back ends (`@jeswr/storage-client/solid` and `/lws`) or the
low-level auth packages. A workspace check, `pnpm run check:sdk-layers`, enforces that.

## Older packages

You may meet `@jeswr/solid-auth-core`, `@jeswr/solid-dpop`, `@jeswr/solid-openid-client` and
`@jeswr/solid-session-restore` in older apps. They are deprecated in favour of `@jeswr/pod-auth`.
Do not start new code on them.

Next: [your first app](02-first-app.md).
