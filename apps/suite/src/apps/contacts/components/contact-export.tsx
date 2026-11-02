// AUTHORED-BY Codex GPT-6.1-Sol
"use client";
import { Button, toast } from "@jeswr/suite-ui";
import { Upload } from "lucide-react";
import { exportContacts } from "../lib/import-export";
import type { ContactData } from "../lib/model";
export function ContactExport({
  contacts,
  all = false,
}: {
  contacts: readonly ContactData[];
  all?: boolean;
}) {
  return (
    <Button
      variant="ghost"
      disabled={!contacts.length}
      onClick={() => {
        try {
          const url = URL.createObjectURL(
            new Blob([exportContacts(contacts)], { type: "text/vcard;charset=utf-8" }),
          );
          const link = document.createElement("a");
          link.href = url;
          link.download = all ? "contacts.vcf" : "contact.vcf";
          document.body.append(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        } catch {
          toast.error("Could not export these contacts. Please try again.");
        }
      }}
    >
      <Upload size={16} aria-hidden="true" />
      {all ? "Export all (.vcf)" : "Export (.vcf)"}
    </Button>
  );
}
