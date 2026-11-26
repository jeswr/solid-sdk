// AUTHORED-BY Claude Opus 5.5
"use client";
import { en } from "@jeswr/suite-i18n";
import { useT } from "@jeswr/suite-i18n/react";

interface Labelled {
  id: string;
  label: string;
}

/** Translated Home domain and data-type labels; an id without a catalog entry keeps its label. */
export function useHomeLabels() {
  const t = useT();
  return {
    domain: ({ id, label }: Labelled) =>
      Object.hasOwn(en.home.domains, id)
        ? t(`home.domains.${id as keyof typeof en.home.domains}`)
        : label,
    type: ({ id, label }: Labelled) =>
      Object.hasOwn(en.home.types, id)
        ? t(`home.types.${id as keyof typeof en.home.types}`)
        : label,
  };
}
