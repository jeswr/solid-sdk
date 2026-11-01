// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
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
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="link">What is a pod?</Button>
      </SheetTrigger>
      <SheetContent side="bottom">
        <SheetHeader>
          <SheetTitle>What is a pod?</SheetTitle>
          <SheetDescription>
            A pod is a place to keep your data online. You choose which apps and people can use it.
            Your files stay with your chosen provider, and you can change who has access at any
            time.
          </SheetDescription>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  );
}
