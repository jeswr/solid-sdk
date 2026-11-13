// AUTHORED-BY Codex GPT-6.1-Sol
import { DEMO_APP_CLIENT_ID, DEMO_APP_LOGO } from "../../../../lib/demo-pod/seed-permission-app";

/** Only these two public seed documents use the fixture pod; no real session fetch. */
export async function demoClientResource(
  url: string,
  init?: RequestInit,
): Promise<Response | undefined> {
  if (
    process.env.NEXT_PUBLIC_DEV_FIXTURES !== "1" ||
    (url !== DEMO_APP_CLIENT_ID && url !== DEMO_APP_LOGO)
  )
    return undefined;
  const { getDemoPod } = await import("../../../../lib/demo-pod/browser");
  return (await getDemoPod()).fetch(url, init);
}

/** Called only after Show logo. A demo SVG needs no network or object-URL lifecycle. */
export async function clientLogoSource(url: string): Promise<string | undefined> {
  try {
    const response = await demoClientResource(url, { credentials: "omit", redirect: "error" });
    if (!response) return url;
    if (
      !response.ok ||
      response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() !== "image/svg+xml"
    )
      return undefined;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(await response.text())}`;
  } catch {
    return undefined;
  }
}
