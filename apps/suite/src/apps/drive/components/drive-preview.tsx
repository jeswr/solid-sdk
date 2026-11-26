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
import { previewImageResolverFor } from "../lib/preview/foreign";

export interface DrivePreviewProps extends Omit<PreviewPaneProps, "source"> {
  session: { fetch: typeof globalThis.fetch; storageUrl: string };
  /** The previewed resource: images it names are read over a transport chosen from this. */
  resourceUrl: string;
  source?: Omit<PreviewSource, "typedView">;
  data?: TypedViewData;
  showTechnicalDetails?: boolean;
}

/** The Drive owner supplies the current session and the parsed preview projection. */
export function DrivePreview({
  session,
  resourceUrl,
  source,
  data,
  showTechnicalDetails = false,
  ...paneProps
}: DrivePreviewProps) {
  const resolveImage = useMemo(
    () => previewImageResolverFor(session, resourceUrl),
    [session, resourceUrl],
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
