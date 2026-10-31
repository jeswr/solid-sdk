// AUTHORED-BY Codex GPT-6.1-Sol
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { DrivePreview } from "../src/apps/drive/components/drive-preview";

const root = createRoot(document.body);
const blob = new Blob([], { type: "text/turtle" });
const requests: AbortSignal[] = [];
const revoked: string[] = [];
const imageUrls = new Set<string>();
const create = URL.createObjectURL.bind(URL);
const revoke = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  const url = create(blob);
  if (blob instanceof Blob && blob.type.startsWith("image/")) imageUrls.add(url);
  return url;
};
URL.revokeObjectURL = (url) => {
  if (imageUrls.has(url)) revoked.push(url);
  revoke(url);
};
const sessions = ["first", "second"].map((id) => ({
  fetch: (url: RequestInfo | URL, init?: RequestInit) => {
    if (init?.signal) requests.push(init.signal);
    return fetch(url, { ...init, headers: { "x-test-session": id } });
  },
}));

export const preview = {
  requests,
  revoked,
  show(
    image = "https://pod.example/private.svg",
    session = 0,
    type = "https://schema.org/Photograph",
    advanced = false,
  ) {
    root.render(
      <StrictMode>
        <DrivePreview
          session={sessions[session] as (typeof sessions)[number]}
          source={{ name: "Private preview", blob }}
          data={{
            types: [type],
            title: "Private preview",
            properties: [],
            image: { src: image, alt: "Private artwork" },
            rawData: "Technical serialization",
          }}
          showTechnicalDetails={advanced}
        />
      </StrictMode>,
    );
  },
  close() {
    root.render(<DrivePreview session={sessions[0] as (typeof sessions)[number]} />);
  },
};

declare global {
  interface Window {
    drivePreview: typeof preview;
  }
}
window.drivePreview = preview;
