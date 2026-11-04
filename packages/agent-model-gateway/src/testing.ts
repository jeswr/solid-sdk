// AUTHORED-BY Codex GPT-6.1-Sol
import type { GuardOptions } from "@jeswr/guarded-fetch";

/** Scripted in-process HTTP fake; exhaustion fails closed without contacting any provider. */
export function fakeFetch(responses: readonly Response[]): {
  fetch: NonNullable<GuardOptions["fetch"]>;
  requests: { url: string; init: RequestInit | undefined }[];
} {
  const requests: { url: string; init: RequestInit | undefined }[] = [];
  const queue = [...responses];
  return {
    requests,
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      const response = queue.shift();
      if (!response) throw new Error("Fake provider exhausted");
      return response;
    },
  };
}
