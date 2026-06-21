// AUTHORED-BY Claude Opus 4.8 (Fable unavailable) — re-review/upgrade candidate
//
// JSX typing for the @jeswr/solid-components data-bound custom elements used in
// TSX WITHOUT an `@ts-expect-error` (house rule: never silence type errors).
//
// These are the Phase-1 READ-ONLY elements: <solid-view> (the resolve-by-type
// composer) plus the per-class read elements. Each takes a `src` URL ATTRIBUTE
// and an injectable `.fetch` / `.publicFetch` OBJECT property (set via a ref —
// see components/solid/PodDataView.tsx). The element classes self-register as a
// side effect of `import "@jeswr/solid-components"`.
//
// We type each tag's element instance as the matching class so a `ref` is
// correctly typed, and allow the `src` attribute + the seam properties. React 19
// reads intrinsic-element types from `React.JSX.IntrinsicElements`.
//
// PHASE 2 (write/edit) is not yet shipped by @jeswr/solid-components; when the
// edit-mode elements land, add their tags here in the same change.
import type {
  JeswrBookmarkList,
  JeswrCollection,
  JeswrContactList,
  JeswrProfileCard,
  JeswrShaclView,
  JeswrTaskList,
  SolidView,
} from "@jeswr/solid-components";
import type { DetailedHTMLProps, HTMLAttributes, Ref } from "react";

/** Common props every read element accepts: a `src` URL + the fetch seam (via ref). */
type ReadElementProps<T> = HTMLAttributes<T> & {
  /** The resource / container URL to read (an attribute). */
  src?: string;
  /** Read with the public (credential-free) fetch — the `public-read` attribute. */
  "public-read"?: boolean;
  ref?: Ref<T>;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "solid-view": DetailedHTMLProps<
        ReadElementProps<SolidView> & {
          /** Pin the class IRI to skip the rdf:type network probe (`class-iri`). */
          "class-iri"?: string;
        },
        SolidView
      >;
      "jeswr-task-list": DetailedHTMLProps<ReadElementProps<JeswrTaskList>, JeswrTaskList>;
      "jeswr-contact-list": DetailedHTMLProps<
        ReadElementProps<JeswrContactList>,
        JeswrContactList
      >;
      "jeswr-profile-card": DetailedHTMLProps<
        ReadElementProps<JeswrProfileCard>,
        JeswrProfileCard
      >;
      "jeswr-bookmark-list": DetailedHTMLProps<
        ReadElementProps<JeswrBookmarkList>,
        JeswrBookmarkList
      >;
      "jeswr-collection": DetailedHTMLProps<
        ReadElementProps<JeswrCollection>,
        JeswrCollection
      >;
      "jeswr-shacl-view": DetailedHTMLProps<HTMLAttributes<JeswrShaclView>, JeswrShaclView>;
    }
  }
}
