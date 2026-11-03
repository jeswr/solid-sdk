// AUTHORED-BY Codex GPT-6.1-Sol
export type ShareRole = "viewer" | "commenter" | "editor" | "manager";
export type ShareKind = "file" | "folder" | "document" | "chatroom";
export interface SharePerson {
  webId: string;
  name?: string;
  photoUrl?: string;
  role: ShareRole | "owner";
  inherited?: { from: string; fromName: string };
  expires?: Date;
}
export interface SharingState {
  people: SharePerson[];
  general: { mode: "restricted" | "link" | "signed-in"; role?: "viewer" | "commenter" | "editor" };
  canManage: boolean;
  readOnly?: "forbidden" | "offline";
  /** Access is available even while the application's derived member list needs repair. */
  warning?: "members-sync";
}
export interface ShareCapabilities {
  publicLinks: boolean;
  authenticatedAgentGrants: boolean;
  grantExpiry: boolean;
  grantPurpose: boolean;
  notifyAgents: boolean;
  accessRequests: boolean;
  managerRole: boolean;
}
export interface SharingAdapter {
  load(url: string, signal: AbortSignal): Promise<SharingState>;
  setPerson(
    url: string,
    webId: string,
    role: ShareRole | null,
    opts?: { expires?: Date; purpose?: string },
  ): Promise<void>;
  setGeneral(url: string, general: SharingState["general"]): Promise<void>;
  notify?(url: string, webIds: string[], message?: string): Promise<void>;
  requestAccess?(
    url: string,
    req: { role: ShareRole; message?: string; purpose?: string },
  ): Promise<void>;
  /** An adapter may narrow roles further, e.g. a document without a comments resource. */
  supportsCommenter?: boolean;
  supportsGeneralCommenter?: boolean;
}
export type ShareErrorCode = "forbidden" | "network" | "conflict" | "unsupported" | "members-sync";
export class ShareError extends Error {
  constructor(public readonly code: ShareErrorCode) {
    super(
      {
        forbidden: "You can't change who has access to this",
        network: "Can't reach your storage. Try again.",
        "members-sync": "Access was saved, but the project's member list wasn't updated.",
        conflict: "Sharing changed somewhere else. Review the updated access and try again.",
        unsupported: "Not available on this storage",
      }[code],
    );
  }
}
