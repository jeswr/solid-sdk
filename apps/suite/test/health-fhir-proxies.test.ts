// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
import { describe, expect, it, vi } from "vitest";
import {
  assertFhirBundle,
  buildFhirBundle,
  FhirExportError,
  type FhirExportOptions,
  type HealthRecords,
  MAX_FHIR_RECORDS,
  MAX_FHIR_STRING_LENGTH,
  serialiseFhirBundle,
} from "../src/apps/health/lib/fhir";

function records(): HealthRecords {
  return {
    observations: [
      {
        id: "weight",
        metric: "weight",
        value: 72.5,
        unit: "kg",
        effective: "2026-10-01T12:00:00Z",
        source: "Fictional example.org scale",
      },
      {
        id: "pressure",
        metric: "bloodPressure",
        value: { systolic: 120, diastolic: 80 },
        unit: "mm[Hg]",
        effective: "2026-10-01T12:00:00Z",
        source: "Fictional example.org cuff",
      },
    ],
    medications: [
      {
        id: "medicine",
        name: "Fictional medicine",
        dosageText: "Fictional dosage",
        start: "2026-09-01",
        end: "2026-09-30",
      },
    ],
    conditions: [{ id: "condition", name: "Fictional condition", onset: "2026-08-01" }],
  };
}

function options(): FhirExportOptions {
  let sequence = 0;
  return {
    clock: () => new Date("2026-10-26T12:00:00Z"),
    uuid: () => `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    patientReference: "https://example.org/Patient/fictional-person",
  };
}

function rejects(action: () => unknown, code: FhirExportError["code"]): void {
  try {
    action();
    expect.fail("Expected typed rejection");
  } catch (error) {
    expect(error).toBeInstanceOf(FhirExportError);
    expect(error).toMatchObject({ code });
    expect((error as Error).message).not.toContain("private proxy detail");
  }
}

/** Recursively forbid property gets and repeat descriptor reads on caller data. */
function descriptorOnly<T extends object>(value: T): T {
  const reads = new Set<PropertyKey>();
  return new Proxy(value, {
    get() {
      throw new Error("private proxy detail: property get");
    },
    getOwnPropertyDescriptor(target, key) {
      if (reads.has(key)) throw new Error("private proxy detail: repeated descriptor");
      reads.add(key);
      const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
      if (!descriptor) throw new Error("Unexpected test descriptor");
      const field = descriptor.value;
      return {
        ...descriptor,
        value: typeof field === "object" && field !== null ? descriptorOnly(field) : field,
      };
    },
  });
}

function revoked(value: object): object {
  const proxy = Proxy.revocable(value, {});
  proxy.revoke();
  return proxy.proxy;
}

describe("FHIR caller-data snapshots", () => {
  it("reads each descriptor once throughout export, including nested values and options", () => {
    const expected = serialiseFhirBundle(records(), options());
    const actual = serialiseFhirBundle(descriptorOnly(records()), descriptorOnly(options()));
    expect(actual).toBe(expected);
    assertFhirBundle(JSON.parse(actual));
  });

  it("self-checks every emitted kind and nested field using descriptor snapshots", () => {
    const bundle = buildFhirBundle(records(), options());
    const checked = assertFhirBundle(descriptorOnly(bundle));
    expect(JSON.parse(JSON.stringify(checked))).toEqual(bundle);
  });

  it("returns validated descriptor values when bundle and nested proxy gets disagree", () => {
    const expected = buildFhirBundle(records(), options());
    const input = buildFhirBundle(records(), options());
    const entry = input.entry?.[0];
    if (!entry) throw new Error("Expected fixture entry");
    const get = vi.fn(() => "unvalidated proxy value");
    entry.resource = new Proxy(entry.resource, { get });
    const checked = assertFhirBundle(new Proxy(input, { get }));
    expect(checked).toEqual(expected);
    expect(checked.type).toBe("collection");
    expect(checked.entry?.[0]?.resource.resourceType).toBe("Condition");
    expect(get).not.toHaveBeenCalled();
  });

  it("returns fresh objects and arrays throughout the bundle without mutating the input", () => {
    const input = buildFhirBundle(records(), options());
    const before = JSON.stringify(input);
    const checked = assertFhirBundle(input);
    function independent(actual: unknown, original: unknown): void {
      if (typeof original !== "object" || original === null) return;
      expect(actual).not.toBe(original);
      for (const key of Object.keys(original)) {
        independent(
          (actual as Record<string, unknown>)[key],
          (original as Record<string, unknown>)[key],
        );
      }
    }
    expect(checked).toEqual(input);
    independent(checked, input);
    expect(JSON.stringify(input)).toBe(before);
    const entry = input.entry?.[0];
    if (entry?.resource.resourceType !== "Condition") {
      throw new Error("Expected fixture condition");
    }
    entry.resource.code.text = "Changed after validation";
    input.entry?.pop();
    expect(JSON.parse(JSON.stringify(checked))).toEqual(JSON.parse(before));
  });

  it.each(["source", "value"])("builds from the validated %s instead of a proxy get", (key) => {
    const input = records();
    const original = input.observations[0];
    if (!original) throw new Error("Expected fixture observation");
    const oversized = "a".repeat(MAX_FHIR_STRING_LENGTH + 1);
    const observation = new Proxy(original, {
      get(target, field, receiver) {
        if (field === key) return key === "source" ? oversized : NaN;
        return Reflect.get(target, field, receiver);
      },
    });
    const actual = serialiseFhirBundle({ ...input, observations: [observation] }, options());
    expect(actual).toBe(serialiseFhirBundle({ ...input, observations: [original] }, options()));
    expect(actual).not.toContain(oversized);
    expect(actual).not.toContain('"value":null');
    assertFhirBundle(JSON.parse(actual));
  });

  it.each([
    "observations",
    "medications",
    "conditions",
  ] as const)("checks the captured %s length before reflection, elements or callbacks", (field) => {
    let reads = 0;
    const inspect = vi.fn(() => {
      throw new Error("private proxy detail: must not inspect oversized array");
    });
    const values = new Proxy(new Array(MAX_FHIR_RECORDS + 1), {
      get(target, key, receiver) {
        // Previously the first length get passed the bound, then iteration saw the full array.
        if (key === "length") return reads++ === 0 ? 0 : MAX_FHIR_RECORDS + 1;
        return Reflect.get(target, key, receiver);
      },
      ownKeys: inspect,
    });
    const injected = { clock: vi.fn(options().clock), uuid: vi.fn(options().uuid) };
    rejects(() => buildFhirBundle({ ...records(), [field]: values }, injected), "TOO_MANY_RECORDS");
    expect(reads).toBe(0);
    expect(inspect).not.toHaveBeenCalled();
    expect(injected.clock).not.toHaveBeenCalled();
    expect(injected.uuid).not.toHaveBeenCalled();
  });

  it("rejects a length descriptor inconsistent with the array instead of rereading it", () => {
    let reads = 0;
    const input = records();
    const values = new Proxy([...input.observations], {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return key === "length" ? { ...descriptor, value: reads++ === 0 ? 0 : 2 } : descriptor;
      },
    });
    rejects(() => buildFhirBundle({ ...input, observations: values }, options()), "INVALID_INPUT");
    expect(reads).toBe(1);
  });

  it.each([
    NaN,
    Infinity,
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    "1",
    undefined,
    null,
    BigInt(1),
  ])("rejects a non-integer or negative proxy length %s before element work", (length) => {
    const inspect = vi.fn(() => []);
    const values = new Proxy([], {
      getOwnPropertyDescriptor(target, key) {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, key);
        return key === "length" ? { ...descriptor, value: length } : descriptor;
      },
      ownKeys: inspect,
    });
    rejects(
      () => buildFhirBundle({ ...records(), conditions: values }, options()),
      "INVALID_INPUT",
    );
    rejects(
      () => assertFhirBundle({ ...buildFhirBundle(records(), options()), entry: values }),
      "INVALID_BUNDLE",
    );
    expect(inspect).not.toHaveBeenCalled();
  });

  it("checks the self-check's entry bound from its descriptor before inspecting entries", () => {
    const inspect = vi.fn(() => {
      throw new Error("private proxy detail: must not inspect entries");
    });
    const entries = new Proxy(new Array(MAX_FHIR_RECORDS + 1), {
      get: () => 0,
      ownKeys: inspect,
    });
    rejects(
      () => assertFhirBundle({ ...buildFhirBundle(records(), options()), entry: entries }),
      "TOO_MANY_RECORDS",
    );
    expect(inspect).not.toHaveBeenCalled();
  });
});

describe("FHIR reflection failures", () => {
  it.each([
    "getPrototypeOf",
    "ownKeys",
    "getOwnPropertyDescriptor",
  ] as const)("wraps throwing %s traps in input, options, arrays and self-check data", (trap) => {
    const fail = () => {
      // Even a caller-thrown FhirExportError must not expose its message or chosen code.
      throw new FhirExportError("UNSUPPORTED_METRIC", "private proxy detail");
    };
    const proxy = <T extends object>(value: T): T => new Proxy(value, { [trap]: fail });
    const condition = records().conditions[0];
    if (!condition) throw new Error("Expected fixture condition");
    rejects(() => buildFhirBundle(proxy(records()), options()), "INVALID_INPUT");
    rejects(() => buildFhirBundle(records(), proxy(options())), "INVALID_OPTIONS");
    rejects(
      () => buildFhirBundle({ ...records(), observations: proxy([]) }, options()),
      "INVALID_INPUT",
    );
    rejects(
      () => buildFhirBundle({ ...records(), conditions: [proxy(condition)] }, options()),
      "INVALID_INPUT",
    );
    const bundle = buildFhirBundle(records(), options());
    rejects(() => assertFhirBundle(proxy(bundle)), "INVALID_BUNDLE");
    rejects(
      () => assertFhirBundle({ ...bundle, entry: proxy(bundle.entry as object[]) }),
      "INVALID_BUNDLE",
    );
    rejects(
      () => assertFhirBundle({ ...bundle, entry: [proxy(bundle.entry?.[0] as object)] }),
      "INVALID_BUNDLE",
    );
  });

  it.each([{}, []])("wraps Array.isArray failures on revoked proxies", (target) => {
    const value = revoked(target);
    rejects(() => buildFhirBundle(value as HealthRecords, options()), "INVALID_INPUT");
    rejects(() => buildFhirBundle(records(), value as FhirExportOptions), "INVALID_OPTIONS");
    rejects(
      () => buildFhirBundle({ ...records(), observations: value as [] }, options()),
      "INVALID_INPUT",
    );
    rejects(() => assertFhirBundle(value), "INVALID_BUNDLE");
    rejects(
      () => assertFhirBundle({ ...buildFhirBundle(records(), options()), entry: value }),
      "INVALID_BUNDLE",
    );
  });

  it("wraps array element descriptor failures without calling property gets", () => {
    const values = new Proxy([...records().conditions], {
      getOwnPropertyDescriptor(target, key) {
        if (key === "0") throw new Error("private proxy detail");
        return Reflect.getOwnPropertyDescriptor(target, key);
      },
    });
    rejects(
      () => buildFhirBundle({ ...records(), conditions: values }, options()),
      "INVALID_INPUT",
    );
    rejects(
      () => assertFhirBundle({ ...buildFhirBundle(records(), options()), entry: values }),
      "INVALID_BUNDLE",
    );
  });

  it("rejects accessors in options and self-check objects without invoking them", () => {
    const getter = vi.fn(() => {
      throw new Error("private proxy detail");
    });
    const injected = Object.defineProperty(options(), "patientReference", { get: getter });
    rejects(() => buildFhirBundle(records(), injected), "INVALID_OPTIONS");
    const bundle = Object.defineProperty(buildFhirBundle(records(), options()), "entry", {
      get: getter,
    });
    rejects(() => assertFhirBundle(bundle), "INVALID_BUNDLE");
    expect(getter).not.toHaveBeenCalled();
  });
});
