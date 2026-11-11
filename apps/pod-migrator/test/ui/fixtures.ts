// AUTHORED-BY GPT-6.1 Sol

import type { SessionContextValue } from "@jeswr/app-session/react";
import { fakePodAuth } from "@jeswr/app-session/testing";
import type { Identity } from "@jeswr/pod-auth";
import { vi } from "vitest";
import type { MigrationPlan } from "../../src/App.js";
import { type ConnectionId, PodConnection } from "../../src/auth/connections.js";

// Shared profile decoration is public. Keep every test offline, including the captured transport.
vi.hoisted(() => {
  globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch;
});

export const sourceWebId = "https://source.example/profile/card#me";
export const targetWebId = "https://target.example/profile/card#me";
export const sourceRoot = "https://storage.example/alice/";
export const targetRoot = "https://storage.example/bob/";
export const profileTurtle = `@prefix pim: <http://www.w3.org/ns/pim/space#>.
<https://source.example/profile/card#me> pim:storage <https://storage.example/alice/>.
<https://target.example/profile/card#me> pim:storage <https://storage.example/bob/>.`;

/** Add only migrator profile/server fixtures to the shared protocol fake. */
export function fakeAuth(webId: string | null = sourceWebId, issuer = "https://issuer.example/") {
  const { auth, emit } = fakePodAuth();
  const currentIdentity = (): Identity | null =>
    webId
      ? {
          webId,
          subject: webId,
          issuer,
          clientId: "https://app.example/clientid.jsonld",
          protocol: "solid-oidc",
          storages: [webId === targetWebId ? targetRoot : sourceRoot],
        }
      : null;
  auth.restore.mockImplementation(async () => {
    const value = currentIdentity();
    emit("restore", value);
    return value;
  });
  auth.identity.mockImplementation(async () => currentIdentity());
  auth.login.mockImplementation(async () => {
    webId ??= sourceWebId;
    const value = currentIdentity() as Identity;
    emit("login", value);
    return value;
  });
  auth.logout.mockImplementation(async () => {
    webId = null;
    emit("logout", null);
  });
  auth.fetch.mockImplementation(
    async () =>
      new Response(profileTurtle, {
        headers: { "content-type": "text/turtle", "x-powered-by": "Community Solid Server" },
      }),
  );
  return Object.assign(auth, {
    publicFetch: vi.fn<typeof fetch>(
      async () => new Response(profileTurtle, { headers: { "content-type": "text/turtle" } }),
    ),
    emit,
  });
}

export function sessionFor(
  auth: ReturnType<typeof fakeAuth>,
  webId: string | null = sourceWebId,
): SessionContextValue {
  return {
    webId,
    session: null,
    fetch: auth.fetch,
    logout: auth.logout,
    restoringSession: false,
    ready: true,
    error: null,
    pending: null,
    recentAccounts: [],
    recentProviders: [],
    startupFailed: false,
    retry: vi.fn(),
    loginWithAddress: vi.fn(),
    loginWithIssuer: vi.fn(),
    loginWithAccount: vi.fn(),
  };
}

export function connectionFor(id: ConnectionId, auth: ReturnType<typeof fakeAuth>) {
  return new PodConnection(id, async () => auth, auth.publicFetch);
}

export function fakeConnections() {
  return [
    connectionFor("source", fakeAuth()),
    connectionFor("target", fakeAuth(targetWebId)),
  ] as const;
}

export const samplePlan: MigrationPlan = {
  sourceSystem: "wac",
  targetSystem: "acp",
  resources: [
    {
      sourceUrl: `${sourceRoot}notes.txt`,
      targetUrl: `${targetRoot}notes.txt`,
      kind: "resource",
      contentType: "text/plain",
      size: 80,
    },
  ],
  stats: { resources: 1, containers: 1, bytes: 80, aclDocuments: 2 },
  report: [
    {
      id: "owner",
      kind: "source-owner-kept",
      severity: "info",
      resourceUrl: sourceRoot,
      title: "Keep the source account’s access",
      explanation: "The source account can still access these files with the same WebID.",
      options: [
        {
          id: "acknowledge",
          label: "Keep this access",
          description: "Keep the original account’s permissions.",
        },
      ],
      recommended: "acknowledge",
    },
    ...["friends", "colleagues"].map((name) => ({
      id: name,
      kind: "group-unsupported" as const,
      severity: "needs-decision" as const,
      resourceUrl: `${sourceRoot}${name}/`,
      title: `Group access for ${name}`,
      explanation:
        "The destination cannot follow this group’s changing membership. Choose how to handle its access.",
      sourceRuleTurtle:
        "@prefix acl: <http://www.w3.org/ns/auth/acl#>. <#group> acl:mode acl:Read.",
      options: [
        {
          id: "skip" as const,
          label: "Leave out the group grant",
          description: "Group members will not gain access from this rule.",
        },
        {
          id: "abort" as const,
          label: "Stop the migration",
          description: "Do not write anything to the destination.",
        },
      ],
      recommended: "skip" as const,
    })),
  ],
};
