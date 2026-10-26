// AUTHORED-BY Codex GPT-6.1-Sol
/** Decoded, single-mailbox snapshot. IDs identify resources, not Message-ID headers. */
export interface ThreadMessage {
  readonly id: string;
  readonly messageId?: string;
  readonly inReplyTo?: string;
  readonly references?: readonly string[];
  readonly subject: string;
  /** Integer Unix milliseconds, UTC years 0001–9999. */
  readonly timestamp: number;
  readonly from: string;
  readonly to: readonly string[];
  readonly cc?: readonly string[];
  readonly isRead: boolean;
  /** Decoded plain text; HTML/MIME decoding belongs to the importer. */
  readonly text: string;
}

export interface ThreadNode<T extends ThreadMessage = ThreadMessage> {
  /** Null only for a synthetic root joining sibling conversations/missing ancestors. */
  readonly message: T | null;
  readonly children: ThreadNode<T>[];
}

export interface MailThread<T extends ThreadMessage = ThreadMessage> {
  /** Smallest resource ID in UTF-16 order. Snapshot identity, not a persisted thread ID. */
  readonly id: string;
  readonly root: ThreadNode<T>;
  readonly subject: string;
  readonly messages: T[];
  readonly latestTimestamp: number;
  readonly participants: string[];
  readonly unreadCount: number;
  readonly snippet: string;
}
