// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// JSX typing for the loading element rendered directly by the Chat host.
import type { DetailedHTMLProps, HTMLAttributes } from "react";

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      // @jeswr/solid-elements <jeswr-loading> as a RAW custom element, so the host
      // can pass `label` as a real DOM ATTRIBUTE (the Lit reactive property
      // auto-observes the lowercased `label` attr). We render it directly rather than
      // through the @lit/react `Loading` wrapper because that wrapper's PROPERTY
      // forwarding is unreliable under React 19 (it classifies props at
      // createComponent-time, before Lit finalises the element class — so `label`
      // can silently fall through and the visible + announced copy is lost). The
      // attribute path is environment-independent and verified. (See App.tsx.)
      "jeswr-loading": DetailedHTMLProps<
        HTMLAttributes<HTMLElement> & { label?: string },
        HTMLElement
      >;
    }
  }
}
