// AUTHORED-BY Codex (GPT-6.1 Sol)
/** The fill-link contract. Network host/address checks belong to guarded-fetch. */
export function formUrl(value: string, development = process.env.NODE_ENV === "development"): URL {
  if (
    value.length > 4096 ||
    !/^https?:\/\//.test(value) ||
    /[\s\\]/.test(value) ||
    /^https?:\/\/[^/?#]*@/.test(value)
  )
    throw new Error("Use a complete HTTPS form address (up to 4096 characters).");
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(development && ["localhost", "127.0.0.1"].includes(url.hostname)))
  )
    throw new Error("Use an HTTPS form address without a username or password.");
  return url;
}
