// AUTHORED-BY Codex GPT-6.1-Sol
import { NS } from "@jeswr/suite-vocab";
import {
  LiteralAs,
  LiteralFrom,
  NamedNodeAs,
  NamedNodeFrom,
  OptionalAs,
  OptionalFrom,
  SetFrom,
} from "@rdfjs/wrapper";
import { PodThing, SCHEMA } from "../core/vocab.js";

/** Adapter state is isolated from standard descriptive properties. */
export const DRIVE_VOCAB = NS.POD_DRIVE;
export class DriveMetadata extends PodThing {
  get encodingFormat(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}encodingFormat`, LiteralAs.string);
  }
  set encodingFormat(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}encodingFormat`, value, LiteralFrom.string);
  }
  get contentSize(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${SCHEMA}contentSize`, LiteralAs.string);
  }
  set contentSize(value: string | undefined) {
    OptionalAs.object(this, `${SCHEMA}contentSize`, value, LiteralFrom.string);
  }
  get parents(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}isPartOf`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get encodings(): Set<string> {
    return SetFrom.subjectPredicate(
      this,
      `${SCHEMA}encoding`,
      NamedNodeAs.string,
      NamedNodeFrom.string,
    );
  }
  get checksum(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${DRIVE_VOCAB}md5Checksum`, LiteralAs.string);
  }
  set checksum(value: string | undefined) {
    OptionalAs.object(this, `${DRIVE_VOCAB}md5Checksum`, value, LiteralFrom.string);
  }
  get contentSkipped(): string | undefined {
    return OptionalFrom.subjectPredicate(this, `${DRIVE_VOCAB}contentSkipped`, LiteralAs.string);
  }
  set contentSkipped(value: string | undefined) {
    OptionalAs.object(this, `${DRIVE_VOCAB}contentSkipped`, value, LiteralFrom.string);
  }
}
