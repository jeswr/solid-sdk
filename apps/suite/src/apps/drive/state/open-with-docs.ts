// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6.1
"use client";

import {
  DOCS_READ_ONLY_REASON,
  docsHref,
  openWithDocsState,
  probeDocsWritable,
  skippedSummary,
} from "../lib/open-with/docs";
import { createOpenWithController, type OpenWithControl } from "./open-with";

export type OpenWithDocsControl = OpenWithControl;

export const { useOpenWith: useOpenWithDocs, useWritable: useDocsWritable } =
  createOpenWithController({
    name: "Docs",
    state: (item, { writable, ...context }) =>
      openWithDocsState(item, { ...context, docsWritable: writable }),
    probeWritable: probeDocsWritable,
    async convert(item, session) {
      // Access may have changed since the menu opened.
      if ((await probeDocsWritable(session)) === false) throw new Error(DOCS_READ_ONLY_REASON);
      // The converters and editor stack load only when someone converts.
      const { openWithDocs } = await import("../../docs/hooks/open-with-docs");
      const result = await openWithDocs({ url: item.url, name: item.name }, session, () => {});
      return {
        url: result.url,
        href: docsHref(result.url),
        warning: result.skipped.length ? skippedSummary(result.skipped) : undefined,
      };
    },
  });
