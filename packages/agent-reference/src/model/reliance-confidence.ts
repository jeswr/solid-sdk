// AUTHORED-BY Codex GPT-6
/** Source-signed quality metadata projected as a DQV measurement on its statement. */
import { literalMapper } from "@jeswr/model-runtime";
import { RequiredAs } from "@rdfjs/wrapper";
import { Store } from "n3";
import { z } from "zod";
import { RdfNode } from "./nodes.js";

export const DQV = "http://www.w3.org/ns/dqv#";
const AWP = "https://w3id.org/jeswr/awp#";
const PROV = "http://www.w3.org/ns/prov#";
const XSD = "http://www.w3.org/2001/XMLSchema#";
const decimal = literalMapper(XSD + "decimal");
export const confidenceMeasurementSchema = z.strictObject({
  type: z.literal("http://www.w3.org/ns/dqv#QualityMeasurement"),
  metric: z.string().url(),
  value: z.number().finite().min(0).max(1),
  method: z.string().url().optional(),
  uncertainty: z.enum(["epistemic", "aleatoric"]),
  calibration: z.enum(["calibrated", "uncalibrated"]),
  observations: z
    .strictObject({ correct: z.number().int().nonnegative(), total: z.number().int().positive() })
    .optional(),
});

export class ConfidenceMeasurementNode extends RdfNode {
  get metric(): string | undefined {
    return this.iri(DQV + "isMeasurementOf");
  }
  get score(): number {
    return Number(this.text(DQV + "value", XSD + "decimal"));
  }
  get method(): string | undefined {
    return this.child(PROV + "wasGeneratedBy", ConfidenceMethodActivityNode)?.method;
  }
  get uncertainty(): string | undefined {
    return this.text(AWP + "uncertaintyKind");
  }
  get calibration(): string | undefined {
    return this.text(AWP + "calibration");
  }
  get source(): string | undefined {
    return this.iri(PROV + "wasAttributedTo");
  }
  get computedOn(): string | undefined {
    return this.iri(DQV + "computedOn");
  }
  initialise(
    statement: string,
    issuer: string,
    input: z.infer<typeof confidenceMeasurementSchema>,
  ): void {
    this.types.add(DQV + "QualityMeasurement");
    this.setIri(DQV + "isMeasurementOf", input.metric);
    this.setIri(DQV + "computedOn", statement);
    this.setIri(PROV + "wasAttributedTo", issuer);
    RequiredAs.object(this, DQV + "value", input.value, (value) =>
      decimal.from(value as never, this.factory),
    );
    if (input.method) {
      const activity = new ConfidenceMethodActivityNode(`${this.id}:method`, this.dataset);
      activity.initialise(input.method, issuer);
      this.setNode(PROV + "wasGeneratedBy", activity);
    }
    this.setText(AWP + "uncertaintyKind", input.uncertainty);
    // A model's own estimate, or a number without a method, never claims calibration.
    const sample = input.observations;
    const supported =
      input.method &&
      sample &&
      sample.correct <= sample.total &&
      sample.correct / sample.total === input.value;
    this.setText(AWP + "calibration", supported ? input.calibration : "uncalibrated");
  }
}

class ConfidenceMethodActivityNode extends RdfNode {
  get method(): string | undefined {
    return this.iri(PROV + "used");
  }
  initialise(method: string, source: string): void {
    this.types.add(PROV + "Activity");
    this.setIri(PROV + "used", method);
    this.setIri(PROV + "wasAssociatedWith", source);
  }
}

export class ConfidenceStatementNode extends RdfNode {
  get claimType(): string {
    return this.text(AWP + "claimType") ?? "";
  }
  get measurement(): ConfidenceMeasurementNode | undefined {
    return this.child(DQV + "hasQualityMeasurement", ConfidenceMeasurementNode);
  }
  static fromSignedPayload(input: unknown): ConfidenceStatementNode {
    const source = z
      .object({
        id: z.string().url(),
        issuer: z.string().url(),
        claimType: z.string(),
        method: z.string().optional(),
        qualityMeasurement: confidenceMeasurementSchema.optional(),
      })
      .parse(input);
    const statement = new ConfidenceStatementNode(source.id, new Store());
    statement.setText(AWP + "claimType", source.claimType);
    if (source.qualityMeasurement) {
      const measurement = new ConfidenceMeasurementNode(
        `${source.id}#source-confidence`,
        statement.dataset,
      );
      measurement.initialise(source.id, source.issuer, source.qualityMeasurement);
      statement.setNode(DQV + "hasQualityMeasurement", measurement);
    }
    return statement;
  }
}
