// AUTHORED-BY Claude Fable 5
/**
 * Minimal pod seeding for the dev/test Solid server — test-only plumbing
 * ported from the reviewed reference implementation (the subset these suites
 * use). Fixture bodies are PRE-AUTHORED RDF strings, written with strict
 * `If-None-Match: *` creates; deterministic test fixtures are authored Turtle
 * by design (the strict RDF discipline governs APP code on live pod data).
 */

const TURTLE = "text/turtle";

export interface ResourceFixture {
  /** Pod-root-relative resource path. Must start with `/` and must not be an `.acl` path. */
  path: string;
  /** Pre-authored resource body (Turtle unless `contentType` says otherwise). */
  body: string;
  /** Defaults to `text/turtle`. */
  contentType?: string;
  /**
   * Also PUT a WAC ACL at `${path}.acl` granting `acl:Read` to `foaf:Agent` (anyone) while
   * keeping full owner control. Requires `ownerWebid` — a resource ACL REPLACES the inherited
   * one, so omitting the owner clause would lock the owner out of its own resource.
   */
  publicRead?: boolean;
}

export interface SeedPodOptions {
  /** Fetch used for the writes; pass an authenticated fetch when the server verifies OIDC. */
  fetch?: typeof fetch;
  /** Owner WebID, required by `publicRead` ACLs. */
  ownerWebid?: string;
}

/** Reject IRI references that would break out of a Turtle `<...>` token. */
function assertIriReference(value: string, label: string): void {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control chars are exactly what an IRI reference must not contain
  if (value.length === 0 || /[\u0000-\u0020<>"{}|^`\\]/.test(value)) {
    throw new Error(`${label} is not a valid IRI reference: ${JSON.stringify(value)}`);
  }
}

function assertFixturePath(path: string): void {
  if (!path.startsWith("/")) {
    throw new Error(`fixture path must be pod-root-relative (start with "/"): ${path}`);
  }
  if (path.endsWith(".acl")) {
    throw new Error(
      `fixture path must not target an ACL document directly (use publicRead): ${path}`,
    );
  }
  assertIriReference(path, "fixture path");
}

/**
 * Pre-authored WAC ACL: public (unauthenticated) read of one resource, full owner control.
 * Root-relative IRIs resolve against the ACL document's own base, so the same template works
 * on any pod origin.
 */
export function publicReadAcl(resourcePath: string, ownerWebid: string): string {
  assertFixturePath(resourcePath);
  assertIriReference(ownerWebid, "ownerWebid");
  return `@prefix acl: <http://www.w3.org/ns/auth/acl#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<#public>
    a acl:Authorization ;
    acl:accessTo <${resourcePath}> ;
    acl:agentClass foaf:Agent ;
    acl:mode acl:Read .

<#owner>
    a acl:Authorization ;
    acl:accessTo <${resourcePath}> ;
    acl:agent <${ownerWebid}> ;
    acl:mode acl:Read, acl:Write, acl:Control .
`;
}

async function createOnce(
  fetchImpl: typeof fetch,
  url: string,
  contentType: string,
  body: string,
): Promise<void> {
  const response = await fetchImpl(url, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      // Strict create: seeding an already-populated pod is a harness bug, not a no-op.
      "if-none-match": "*",
    },
    body,
  });
  if (response.status === 412) {
    throw new Error(`seed target already exists (pods must be seeded exactly once): ${url}`);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`seed PUT ${url} failed: ${response.status} ${detail}`.trim());
  }
}

/**
 * Seed a pod with fixture resources (and optional public-read WAC ACLs) over plain HTTP.
 * `baseUrl` is the pod origin; every fixture path resolves against it.
 */
export async function seedPod(
  baseUrl: string,
  fixtures: readonly ResourceFixture[],
  options: SeedPodOptions = {},
): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  const origin = new URL(baseUrl).origin;
  for (const fixture of fixtures) {
    assertFixturePath(fixture.path);
    await createOnce(
      fetchImpl,
      `${origin}${fixture.path}`,
      fixture.contentType ?? TURTLE,
      fixture.body,
    );
    if (fixture.publicRead === true) {
      if (options.ownerWebid === undefined) {
        throw new Error(`publicRead fixture ${fixture.path} requires options.ownerWebid`);
      }
      await createOnce(
        fetchImpl,
        `${origin}${fixture.path}.acl`,
        TURTLE,
        publicReadAcl(fixture.path, options.ownerWebid),
      );
    }
  }
}
