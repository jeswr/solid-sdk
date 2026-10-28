// AUTHORED-BY Codex GPT-6
import type { SolidAuth } from "@jeswr/solid-auth-core";
import { type Mock, vi } from "vitest";
import type { MigrationPlan } from "../../src/App.js";
import { PodConnection } from "../../src/auth/connections.js";

export const sourceWebId = "https://source.example/profile/card#me";
export const targetWebId = "https://target.example/profile/card#me";
export const sourceRoot = "https://storage.example/alice/";
export const targetRoot = "https://storage.example/bob/";
export const profileTurtle = `@prefix pim: <http://www.w3.org/ns/pim/space#>.
<https://source.example/profile/card#me> pim:storage <https://storage.example/alice/>.
<https://target.example/profile/card#me> pim:storage <https://storage.example/bob/>.`;

type FakeAuth = {
  -readonly [K in keyof SolidAuth]: SolidAuth[K] extends (...args: infer Args) => infer Result
    ? Mock<(...args: Args) => Result>
    : SolidAuth[K];
};

export function fakeAuth(webId: string | null = sourceWebId): FakeAuth {
  const auth = {
    webId,
    issuer: "https://issuer.example/",
    publicFetch: vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(profileTurtle, { headers: { "content-type": "text/turtle" } }),
      ),
    authenticatedFetch: vi.fn<typeof fetch>().mockImplementation(
      async () =>
        new Response(profileTurtle, {
          headers: { "content-type": "text/turtle", "x-powered-by": "Community Solid Server" },
        }),
    ),
    restore: vi
      .fn()
      .mockResolvedValue(webId ? { outcome: "restored", webId } : { outcome: "login" }),
    handleRedirect: vi.fn().mockResolvedValue({ outcome: "none" }),
    beginRedirectLogin: vi
      .fn()
      .mockResolvedValue({ authorizationUrl: "https://issuer.example/authorize" }),
    completeRedirectLogin: vi.fn(),
    hasPendingRedirect: vi.fn().mockReturnValue(false),
    reArmAllowedOrigins: vi.fn().mockReturnValue(true),
    logout: vi.fn().mockImplementation(async () => {
      auth.webId = null;
    }),
    dropLiveSession: vi.fn(),
    dropSession: vi.fn(),
    login: vi.fn(),
    rememberAccount: vi.fn(),
    recentAccounts: vi.fn().mockReturnValue([]),
    onSessionChange: vi.fn().mockReturnValue(() => {}),
  } satisfies SolidAuth;
  return auth;
}

export function fakeConnections() {
  return [
    new PodConnection("source", fakeAuth()),
    new PodConnection("target", fakeAuth(targetWebId)),
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
