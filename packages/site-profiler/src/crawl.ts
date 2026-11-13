// AUTHORED-BY Claude Opus 5.5
// Step 1: crawl. Breadth-first over same-origin <a href> links and GET forms filled with sample
// values, in a real browser so script-driven requests are recorded too. The recorder's guard keeps
// every non-GET request from leaving the browser while this runs; the crawler itself only ever
// navigates (GET) and never clicks buttons or submits non-GET forms.

import type { BrowserContext } from "playwright";
import { parseForms, sampleGetUrl } from "./forms.js";
import { attr, descendants, parseHtml, text } from "./html.js";
import type { Recorder } from "./recorder.js";
import type { FormInfo } from "./types.js";
import { isDangerousLink, isStatic, normaliseUrl, sameOrigin } from "./util.js";

export interface PageSnapshot {
  url: string;
  finalUrl: string;
  status?: number;
  /** Rendered DOM after scripts ran. */
  html: string;
  forms: FormInfo[];
}

export interface CrawlOptions {
  startUrl: string;
  maxPages: number;
  /** Word typed into free-text GET form fields; chosen from the start page when omitted. */
  sampleWord?: string;
  navigationTimeoutMs?: number;
}

export interface CrawlResult {
  pages: PageSnapshot[];
  sampleWord: string;
  warnings: string[];
}

const STOP_WORDS = new Set([
  "home",
  "search",
  "basket",
  "orders",
  "account",
  "delivery",
  "sign",
  "with",
  "from",
  "your",
  "this",
  "that",
]);

/** A word to search for: the most frequent word in links to item-like pages (paths with an id), else headings. */
export function chooseSampleWord(html: string): string {
  const doc = parseHtml(html);
  const counts = new Map<string, number>();
  const add = (t: string) => {
    for (const w of t.toLowerCase().match(/[a-z]{4,}/g) ?? []) {
      if (!STOP_WORDS.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  };
  for (const a of descendants(doc)) {
    if (a.name === "a" && /\/[^/]*\d[^/]*\/?$/.test(attr(a, "href") ?? "")) add(text(a));
  }
  if (counts.size === 0)
    for (const h of descendants(doc)) if (/^h[1-3]$/.test(h.name)) add(text(h));
  let best = "test";
  let bestCount = 0;
  for (const [w, c] of counts) {
    if (c > bestCount) {
      best = w;
      bestCount = c;
    }
  }
  return best;
}

export async function crawl(
  context: BrowserContext,
  recorder: Recorder,
  options: CrawlOptions,
): Promise<CrawlResult> {
  const warnings: string[] = [];
  const pages: PageSnapshot[] = [];
  const start = normaliseUrl(options.startUrl);
  if (!start) throw new Error(`Bad start URL: ${options.startUrl}`);
  const queue: string[] = [start];
  const seen = new Set<string>([start]);
  const formsSeen = new Set<string>();
  let sampleWord = options.sampleWord;
  const page = await context.newPage();
  const prevPhase = recorder.phase;
  recorder.phase = "crawl";
  try {
    while (queue.length && pages.length < options.maxPages) {
      const url = queue.shift() as string;
      let status: number | undefined;
      try {
        const res = await page.goto(url, {
          waitUntil: "load",
          timeout: options.navigationTimeoutMs ?? 15_000,
        });
        status = res?.status();
        await page.waitForLoadState("networkidle", { timeout: 3_000 }).catch(() => undefined);
      } catch (err) {
        warnings.push(`crawl: could not load ${url}: ${(err as Error).message.split("\n")[0]}`);
        continue;
      }
      await recorder.flush();
      const finalUrl = page.url();
      if (!sameOrigin(finalUrl, start)) {
        warnings.push(`crawl: ${url} left the site (${new URL(finalUrl).origin})`);
        continue;
      }
      const html = await page.content();
      sampleWord = sampleWord ?? chooseSampleWord(html);
      const forms = parseForms(html, finalUrl);
      const snapshot: PageSnapshot = { url, finalUrl, html, forms };
      if (status !== undefined) snapshot.status = status;
      pages.push(snapshot);

      const enqueue = (href: string, label = "") => {
        const next = normaliseUrl(href, finalUrl);
        if (!next || seen.has(next) || !sameOrigin(next, start) || isStatic(next)) return;
        if (isDangerousLink(next, label)) return;
        seen.add(next);
        queue.push(next);
      };
      const links = await page.$$eval("a[href]", (els) =>
        els.map(
          (a) => [(a as HTMLAnchorElement).href, (a.textContent ?? "").trim()] as [string, string],
        ),
      );
      for (const [href, label] of links) enqueue(href, label);
      for (const form of forms) {
        if (form.method !== "GET") continue;
        const sig = `${form.action}|${form.fields.map((f) => f.name).join(",")}`;
        if (formsSeen.has(sig)) continue;
        formsSeen.add(sig);
        const filled = sampleGetUrl(form, sampleWord);
        if (filled) enqueue(filled);
      }
    }
  } finally {
    await recorder.flush();
    recorder.phase = prevPhase;
    await page.close();
  }
  if (queue.length)
    warnings.push(`crawl: stopped at ${options.maxPages} pages with ${queue.length} unvisited`);
  return { pages, sampleWord: sampleWord ?? "test", warnings };
}
