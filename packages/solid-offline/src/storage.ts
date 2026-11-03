// AUTHORED-BY Codex GPT-6.1-Sol
import type { ReadResult, StorageClient } from '@jeswr/storage-client';

// StorageClient intentionally abstracts HTTP cache policy. Keep the original
// headers/type associated with each result, without exposing credentials to the
// worker or guessing Cache-Control/Vary from the backend's reduced read shape.
const responses = new WeakMap<ReadResult, Response>();

/** Internal transport boundary. Each operation has its own observer, including discovery. */
export async function createPolicyStorage(
  factory: (transport: typeof fetch) => StorageClient | Promise<StorageClient>,
  transport: typeof fetch,
): Promise<StorageClient> {
  const base = await factory(transport);
  async function observe(
    method: 'read' | 'head',
    url: string,
    opts: Parameters<StorageClient['read']>[1] | Parameters<StorageClient['head']>[1],
  ): Promise<ReadResult> {
    let response: Response | undefined;
    const client = await factory(async (input, init) => {
      const request = new Request(input, init);
      const fresh = await transport(request);
      if (
        request.url === new URL(url).href &&
        request.method === (method === 'read' ? 'GET' : 'HEAD')
      ) {
        response = fresh;
      }
      return fresh;
    });
    const result = await client[method](url, opts);
    if (response) responses.set(result, response);
    return result;
  }
  return {
    ...base,
    read: (url, opts) => observe('read', url, opts),
    head: (url, opts) => observe('head', url, opts),
  };
}

/** Undefined for a caller's storage without HTTP evidence: never assume cacheability. */
export function policyResponse(result: ReadResult): Response | undefined {
  return responses.get(result);
}
