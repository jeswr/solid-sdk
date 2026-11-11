// AUTHORED-BY Codex GPT-6.1-Sol
import { ShareError } from "../../../shell/share/types";
import { VerifiedWacSharingAdapter } from "../../../shell/share/verified-wac-adapter";

/** Workbook policies cover the container and its inheriting members. */
export class WorkbookSharingAdapter extends VerifiedWacSharingAdapter {
  override async load(container: string, signal: AbortSignal) {
    if (!container.endsWith("/")) throw new ShareError("unsupported");
    return super.load(container, signal);
  }
}
