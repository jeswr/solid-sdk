// AUTHORED-BY Codex (GPT-6.1 Sol)
"use client";
import { type Deck, readSlideImage, renderSlideMarkdown, type Slide } from "@jeswr/solid-slides";
import { useEffect, useMemo, useState } from "react";
import { useSlides } from "../state/slides-context";

function Markdown({ text }: { text: string }) {
  const html = useMemo(() => renderSlideMarkdown(text), [text]);
  // biome-ignore lint/style/useNamingConvention: React requires the __html property.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: package helper sanitises the marked output with a strict allowlist.
  return <div className="sld-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}
function SlideImage({ url, alt }: { url: string; alt: string }) {
  const { session } = useSlides();
  const [source, setSource] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | undefined;
    let active = true;
    setFailed(false);
    setSource(undefined);
    const controller = new AbortController();
    void readSlideImage(session.fetch, url, controller.signal)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setSource(objectUrl);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [session, url]);
  return source && !failed ? (
    // biome-ignore lint/performance/noImgElement: authenticated pod images use temporary blob URLs.
    <img src={source} alt={alt} onError={() => setFailed(true)} />
  ) : (
    <p role="status">
      {failed ? "Image unavailable. Check the URL or reconnect." : "Loading image…"}
    </p>
  );
}
export function SlideCanvas({
  slide,
  deck,
  thumbnail = false,
}: {
  slide: Slide;
  deck: Deck;
  thumbnail?: boolean;
}) {
  if (thumbnail)
    return (
      <span
        className="sld-canvas"
        data-theme={deck.theme}
        style={{ aspectRatio: deck.aspectRatio === "4:3" ? "4 / 3" : "16 / 9" }}
      >
        <strong>{slide.title}</strong>
        <span>{slide.body?.slice(0, 120)}</span>
      </span>
    );
  return (
    <div
      className="sld-canvas"
      data-theme={deck.theme}
      data-layout={slide.layout}
      style={{ aspectRatio: deck.aspectRatio === "4:3" ? "4 / 3" : "16 / 9" }}
    >
      {slide.layout !== "blank" && (
        <>
          {slide.title && <h3>{slide.title}</h3>}
          {slide.image &&
            slide.layout === "image" &&
            (thumbnail ? (
              <span>Image</span>
            ) : (
              <SlideImage url={slide.image} alt={slide.imageAlt ?? ""} />
            ))}
          <div className="sld-columns">
            <Markdown text={slide.body ?? ""} />
            {slide.layout === "two-column" && <Markdown text={slide.secondBody ?? ""} />}
          </div>
        </>
      )}
    </div>
  );
}
