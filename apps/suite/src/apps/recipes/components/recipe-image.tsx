// AUTHORED-BY Codex GPT-6
"use client";
import { createGuardedFetch } from "@jeswr/guarded-fetch";
import { Button } from "@jeswr/suite-ui";
import { ChefHat } from "lucide-react";
import { useEffect, useState } from "react";

export function RecipeImage({ url }: { url: string | undefined }) {
  const [requested, setRequested] = useState(false);
  const [src, setSrc] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!requested || !url) return;
    const controller = new AbortController();
    const fetchImage = createGuardedFetch({
      fetch: globalThis.fetch,
      dnsLookup: null,
      maxBytes: 2_097_152,
      maxRedirects: 0,
      timeoutMs: 10_000,
      allowedContentTypes: ["image/avif", "image/gif", "image/jpeg", "image/png", "image/webp"],
    });
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const result = await fetchImage(url, {
          credentials: "omit",
          mode: "cors",
          redirect: "error",
          referrerPolicy: "no-referrer",
          signal: controller.signal,
        });
        if (!result.ok) {
          await result.body?.cancel();
          throw new Error("Couldn't load the recipe image");
        }
        const image = await result.blob();
        if (controller.signal.aborted) return;
        objectUrl = URL.createObjectURL(image);
        setSrc(objectUrl);
      } catch {
        if (!controller.signal.aborted) setFailed(true);
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [requested, url]);
  return src ? (
    <div className="recipes-image-preview" style={{ backgroundImage: `url("${src}")` }} />
  ) : (
    <div className="recipes-image-placeholder">
      <ChefHat size={48} strokeWidth={1} aria-hidden="true" />
      {url && !requested && (
        <Button variant="outline" size="sm" onClick={() => setRequested(true)}>
          Load external image
        </Button>
      )}
      {requested && <span role="status">{failed ? "Image unavailable" : "Loading image…"}</span>}
    </div>
  );
}
