// AUTHORED-BY Codex GPT-6.1-Sol
import type { SolidMcpConfig } from "@jeswr/solid-mcp";
// biome-ignore lint/style/useNodejsImportProtocol: agent imports allow only bare package names or relative paths
import { crc32, deflateRawSync } from "zlib";

/** Recorded request made through the real client-credentials and ChatWriter implementations. */
export interface CaptureRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

/** In-memory HTTP pod/token endpoint for fixture-only capture tests; no network or credentials. */
export function createCaptureTestTransport() {
  const requests: CaptureRequest[] = [];
  const resources = new Map<string, string>();
  const etags = new Map<string, string>();
  let revision = 0;
  const httpTransport: SolidMcpConfig["fetch"] = async (input, init) => {
    const request = new Request(input, init);
    const { url, method, headers } = request;
    const body = await request.text();
    requests.push({ url, method, headers, body });
    if (url === "https://issuer.example/token")
      return Response.json({
        access_token: "fixture-access-token",
        token_type: "DPoP",
        expires_in: 3600,
      });
    if (method === "HEAD")
      return new Response(null, {
        status: resources.has(url) ? 200 : 404,
        headers: { link: `<${url}.acl>; rel="acl"` },
      });
    if (method === "PUT") {
      if (headers.get("if-none-match") === "*" && resources.has(url))
        return new Response(null, { status: 412 });
      if (headers.has("if-match") && headers.get("if-match") !== etags.get(url))
        return new Response(null, { status: 412 });
      resources.set(url, body);
      const etag = `"capture-${++revision}"`;
      etags.set(url, etag);
      return new Response(null, { status: 201, headers: { etag } });
    }
    const stored = resources.get(url);
    return new Response(stored, {
      status: stored === undefined ? 404 : 200,
      headers: {
        "content-type": "text/turtle",
        ...(etags.has(url) ? { etag: etags.get(url) as string } : {}),
      },
    });
  };
  return { fetch: httpTransport, requests, resources };
}

/** Build small stored/deflated ZIP fixtures in memory, without touching the filesystem. */
export function createCaptureTestZip(
  entries: { name: string; text: string; deflate?: boolean; descriptor?: boolean }[],
) {
  const locals: Buffer[] = [];
  const headers: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.text);
    const data = entry.deflate ? deflateRawSync(raw) : raw;
    const descriptor = Buffer.alloc(entry.descriptor ? 16 : 0);
    if (entry.descriptor) {
      descriptor.writeUInt32LE(0x08074b50);
      descriptor.writeUInt32LE(crc32(raw), 4);
      descriptor.writeUInt32LE(data.length, 8);
      descriptor.writeUInt32LE(raw.length, 12);
    }
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(entry.descriptor ? 8 : 0, 6);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    if (!entry.descriptor) {
      local.writeUInt32LE(crc32(raw), 14);
      local.writeUInt32LE(data.length, 18);
      local.writeUInt32LE(raw.length, 22);
    }
    local.writeUInt16LE(name.length, 26);
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50);
    header.writeUInt16LE(local.readUInt16LE(6), 8);
    header.writeUInt16LE(local.readUInt16LE(8), 10);
    header.writeUInt32LE(crc32(raw), 16);
    header.writeUInt32LE(data.length, 20);
    header.writeUInt32LE(raw.length, 24);
    header.writeUInt16LE(name.length, 28);
    header.writeUInt32LE(offset, 42);
    locals.push(local, name, data, descriptor);
    headers.push(header, name);
    offset += local.length + name.length + data.length + descriptor.length;
  }
  const directory = Buffer.concat(headers);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
