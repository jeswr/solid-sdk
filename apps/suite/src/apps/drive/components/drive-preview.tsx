// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import {
  PreviewPane,
  type PreviewPaneProps,
  type PreviewSource,
  TypedView,
  type TypedViewData,
} from "@jeswr/suite-ui";
import { useMemo } from "react";
import { createPreviewImageResolver } from "../lib/preview/image-resolver";

export interface DrivePreviewProps extends Omit<PreviewPaneProps, "source"> {
  session: { fetch: typeof globalThis.fetch };
  source?: Omit<PreviewSource, "typedView">;
  data?: TypedViewData;
  showTechnicalDetails?: boolean;
}

/** The Drive owner supplies the current session and the parsed preview projection. */
export function DrivePreview({
  session,
  source,
  data,
  showTechnicalDetails = false,
  ...paneProps
}: DrivePreviewProps) {
  const resolveImage = useMemo(
    () => createPreviewImageResolver((url, init) => session.fetch(url, init)),
    [session],
  );
  const previewSource = source && {
    ...source,
    typedView: data && (
      <TypedView
        data={data}
        resolveImage={resolveImage}
        showTechnicalDetails={showTechnicalDetails}
      />
    ),
  };
  return <PreviewPane {...paneProps} {...(previewSource ? { source: previewSource } : {})} />;
}
