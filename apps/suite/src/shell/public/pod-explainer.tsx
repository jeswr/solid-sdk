// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { useT } from "@jeswr/suite-i18n/react";
import {
  Button,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@jeswr/suite-ui";
export function PodExplainer() {
  const t = useT();
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="link">{t("signin.podQuestion")}</Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>{t("signin.podQuestion")}</SheetTitle>
          <SheetDescription>{t("signin.podDescription")}</SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
