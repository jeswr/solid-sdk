// AUTHORED-BY Codex GPT-6.1-Sol
import { parseRdf } from "@jeswr/fetch-rdf";
import { readContainerMembers } from "@jeswr/ldp-container";
import { DatasetWrapper, SetFrom, TermAs, TermFrom, TermWrapper } from "@rdfjs/wrapper";
import { DataFactory } from "n3";
import { auditContainer } from "./layout.js";
import { MCP } from "./vocab.js";

export interface PersonalDataRead {
  at: string;
  client: string;
  tool?: string;
  purpose?: string;
  categories: string[];
  decision?: "permit" | "prohibited" | "refuse-all";
  resourceCount?: number;
  source: "monthly" | "chain";
}
/** Read must refuse redirects and use the owner's scoped session. Missing reads throw { status }. */
export type AuditRead = (url: string) => Promise<{ text: string; contentType: string }>;
export interface AuditSource {
  list(read: AuditRead, storage: string, limit: number): Promise<PersonalDataRead[]>;
}
const PROV = "http://www.w3.org/ns/prov#";
const DPV = "https://w3id.org/dpv#";
const MAX_BYTES = 256 * 1024;
const MAX_ACTIVITIES = 500;
const ERROR = "Personal data reads unavailable";

/** Only these named predicates are projected; unknown fields and personal values stay in the pod. */
class Activity extends TermWrapper {
  private objects(predicate: string) {
    return [...SetFrom.subjectPredicate(this, predicate, TermAs.term, TermFrom.itself)];
  }
  private iris(predicate: string) {
    return this.objects(predicate)
      .filter((term) => term.termType === "NamedNode")
      .map((term) => term.value);
  }
  private text(predicate: string) {
    const terms = this.objects(predicate);
    return terms.length === 1 && terms[0]?.termType === "Literal" ? terms[0].value : undefined;
  }
  row(): PersonalDataRead | undefined {
    const at = this.text(`${PROV}startedAtTime`);
    const clients = this.iris(`${PROV}wasAssociatedWith`);
    if (!at || !validDate(at) || clients.length !== 1) return;
    const client = clients[0] as string;
    try {
      const url = new URL(client);
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return;
    } catch {
      return;
    }
    const row: PersonalDataRead = {
      at: new Date(at).toISOString(),
      client,
      categories: this.iris(`${DPV}hasPersonalData`),
      source: "monthly",
    };
    const purpose = this.iris(`${DPV}hasPurpose`);
    if (purpose.length === 1) row.purpose = purpose[0] as string;
    const tool = this.text(`${MCP}tool`);
    if (tool) row.tool = tool;
    const decision = this.text(`${MCP}decision`);
    if (decision === "permit" || decision === "prohibited" || decision === "refuse-all")
      row.decision = decision;
    const resources = this.iris(`${PROV}used`);
    if (resources.length) row.resourceCount = resources.length;
    return row;
  }
}

class MonthlyDataset extends DatasetWrapper {
  activities() {
    return this.instancesOf(`${PROV}Activity`, Activity);
  }
}

/** Require a real calendar date and explicit timezone; Date.parse alone normalizes February 30. */
function validDate(value: string): boolean {
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value,
    )
  )
    return false;
  const day = value.slice(0, 10);
  return (
    Number.isFinite(Date.parse(value)) &&
    new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day
  );
}

/** Bounded monthly-file reader. All I/O belongs to the injected read function. No cache or writes. */
export const monthlyAuditSource: AuditSource = {
  async list(read, storage, limit) {
    try {
      if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_ACTIVITIES) throw new Error();
      const container = auditContainer(storage);
      // Adapt the text seam to the shared listing helper; only the container may be missing.
      const fetch: typeof globalThis.fetch = async () => {
        try {
          const result = await read(container);
          return new Response(result.text, { headers: { "content-type": result.contentType } });
        } catch (error) {
          if (
            error &&
            typeof error === "object" &&
            "status" in error &&
            (error.status === 404 || error.status === 410)
          )
            return new Response(null, { status: error.status });
          throw error;
        }
      };
      const members = await readContainerMembers(fetch, container, {
        scope: storage,
        maxBytes: MAX_BYTES,
        maxQuads: 10000,
      });
      const files = (members ?? [])
        .map((member) => member.url)
        .filter((url) => {
          const parsed = new URL(url);
          return (
            !parsed.search && !parsed.hash && /^\d{4}-\d{2}\.ttl$/.test(url.slice(container.length))
          );
        })
        .sort()
        .reverse()
        .slice(0, 3);
      const rows: PersonalDataRead[] = [];
      let activities = 0;
      for (const url of files) {
        const result = await read(url);
        const dataset = await parseRdf(result.text, result.contentType, {
          baseIRI: url,
          maxBytes: MAX_BYTES,
          maxQuads: 10000,
        });
        for (const activity of new MonthlyDataset(dataset, DataFactory).activities()) {
          if (++activities > MAX_ACTIVITIES) throw new Error();
          const row = activity.row();
          if (row) rows.push(row);
        }
      }
      return rows.sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
    } catch {
      throw new Error(ERROR);
    }
  },
};
