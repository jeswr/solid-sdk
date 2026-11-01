// AUTHORED-BY Codex GPT-6
"use client";
import { type TypedRendererProps, TypedView, type TypedViewData } from "@jeswr/suite-ui";

/** Detail projection keeps every friendly field; card renderers intentionally select only a few. */
function DetailFields({ data }: TypedRendererProps) {
  return data.properties.length ? (
    <dl className="suite-metadata">
      {data.properties.map((property) => (
        <div key={property.key}>
          <dt>{property.label}</dt>
          <dd>{property.values.join(" · ")}</dd>
        </div>
      ))}
    </dl>
  ) : (
    <p className="hm-muted">No additional details</p>
  );
}
export function DetailView({ data }: { data: TypedViewData }) {
  // The synthetic display type also covers an untyped subject without changing stored data.
  const detail = { ...data, types: ["detail"] };
  return <TypedView data={detail} registry={new Map([["detail", DetailFields]])} />;
}
