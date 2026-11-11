// AUTHORED-BY Codex GPT-6.1-Sol
export const MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
export const STRICT_MAIN = "http://purl.oclc.org/ooxml/spreadsheetml/main";
export const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const STRICT_REL = "http://purl.oclc.org/ooxml/officeDocument/relationships";
export const PACKAGE_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
export const LIMITS = {
  compressedBytes: 50 * 1024 * 1024,
  elements: 2_000_000,
  entries: 1000,
  entryBytes: 20 * 1024 * 1024,
  totalBytes: 100 * 1024 * 1024,
  sheets: 200,
  rows: 100_000,
  columns: 16_384,
  cells: 2_000_000,
  merges: 10_000,
  /** UTF-16 code units of cell text and formulas, counted per cell even when strings are shared. */
  text: 20_000_000,
};

export class XlsxImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "XlsxImportError";
  }
}

export function requireXlsx(condition: unknown, message: string): asserts condition {
  if (!condition) throw new XlsxImportError(message);
}

export function elements(root: Document | Element, name: string): Element[] {
  return [
    ...root.getElementsByTagNameNS(MAIN, name),
    ...root.getElementsByTagNameNS(STRICT_MAIN, name),
  ];
}

const spreadsheetMl = (element: Element) =>
  element.namespaceURI === MAIN || element.namespaceURI === STRICT_MAIN;

/**
 * The SpreadsheetML elements reached from the root element by `path`, one level of
 * direct children per name. Unlike a subtree search, nesting can't make this quadratic.
 */
export function children(root: Document | Element, ...path: string[]): Element[] {
  let current: Element[] = "documentElement" in root ? [root.documentElement] : [root];
  for (const name of path)
    current = current.flatMap((parent) =>
      [...parent.children].filter((child) => child.localName === name && spreadsheetMl(child)),
    );
  return current;
}

export function coordinate(ref: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9]\d{0,6})(?![\s\S])/.exec(ref);
  requireXlsx(match, "Invalid Excel cell reference");
  let column = 0;
  for (const char of match[1] as string) column = column * 26 + char.charCodeAt(0) - 64;
  const row = Number(match[2]);
  requireXlsx(row <= LIMITS.rows && column <= LIMITS.columns, "Excel row or column limit exceeded");
  return { row: row - 1, column: column - 1 };
}

export function cellRef(row: number, column: number): string {
  let letters = "";
  for (let n = column + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return `${letters}${row + 1}`;
}

function cleanXml(value: string): string {
  return (
    value
      // biome-ignore lint/suspicious/noControlCharactersInRegex: XML 1.0 excludes these code points
      .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, "")
  );
}

export function xml(value: string): string {
  return cleanXml(value).replace(
    /[&<>"'\t\r\n]/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
        "\t": "&#9;",
        "\r": "&#13;",
        "\n": "&#10;",
      })[char] as string,
  );
}

export function documentXml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${body}`;
}

export function sheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    const base =
      cleanXml(
        cleanXml(name)
          .replace(/[[\]:*?/\\]/g, "")
          .replace(/^'+|'+$/g, "")
          .slice(0, 31)
          .replace(/'+$/g, ""),
      ) || "Sheet";
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      candidate = `${cleanXml(base.slice(0, 31 - suffix.length))}${suffix}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Apply `edit` to the parts of a formula outside its string literals and quoted sheet names. */
function outsideStrings(formula: string, edit: (code: string) => string): string {
  return formula
    .split(/("(?:[^"]|"")*"|'(?:[^']|'')*')/)
    .map((part, i) => (i % 2 === 1 ? part : edit(part)))
    .join("");
}

/**
 * Functions added to Excel after 2007 are stored in files with a `_xlfn.` prefix (and
 * `_xlfn._xlws.` for FILTER and SORT). Excel shows #NAME? for them without it.
 */
const FUTURE_FUNCTIONS = new Map<string, string>([
  ...`ACOT ACOTH AGGREGATE ARABIC ARRAYTOTEXT BASE BETA.DIST BETA.INV BINOM.DIST BINOM.DIST.RANGE
BINOM.INV BITAND BITLSHIFT BITOR BITRSHIFT BITXOR BYCOL BYROW CEILING.MATH CEILING.PRECISE
CHISQ.DIST CHISQ.DIST.RT CHISQ.INV CHISQ.INV.RT CHISQ.TEST CHOOSECOLS CHOOSEROWS COMBINA CONCAT
CONFIDENCE.NORM CONFIDENCE.T COT COTH COVARIANCE.P COVARIANCE.S CSC CSCH DAYS DECIMAL DROP
ECMA.CEILING ENCODEURL ERF.PRECISE ERFC.PRECISE EXPAND EXPON.DIST F.DIST F.DIST.RT F.INV F.INV.RT F.TEST
FILTERXML FLOOR.MATH FLOOR.PRECISE FORECAST.ETS FORECAST.ETS.CONFINT FORECAST.ETS.SEASONALITY
FORECAST.ETS.STAT FORECAST.LINEAR FORMULATEXT GAMMA GROUPBY GAMMA.DIST GAMMA.INV GAMMALN.PRECISE GAUSS
HSTACK HYPGEOM.DIST IFNA IFS IMAGE IMCOSH IMCOT IMCSC IMCSCH IMSEC IMSECH IMSINH IMTAN ISFORMULA
ISO.CEILING ISOMITTED ISOWEEKNUM LAMBDA LET LOGNORM.DIST LOGNORM.INV MAKEARRAY MAP MAXIFS MINIFS
MODE.MULT MODE.SNGL MUNIT NEGBINOM.DIST NETWORKDAYS.INTL NORM.DIST NORM.INV NORM.S.DIST NORM.S.INV
NUMBERVALUE PDURATION PERCENTOF PERCENTILE.EXC PERCENTILE.INC PERCENTRANK.EXC PERCENTRANK.INC PERMUTATIONA
PHI PIVOTBY POISSON.DIST QUARTILE.EXC QUARTILE.INC QUERYSTRING RANDARRAY RANK.AVG RANK.EQ REDUCE REGEXEXTRACT REGEXREPLACE REGEXTEST RRI SCAN
SEC SECH SEQUENCE SHEET SHEETS SKEW.P SORTBY STDEV.P STDEV.S STOCKHISTORY SWITCH T.DIST T.DIST.2T T.DIST.RT
T.INV T.INV.2T T.TEST TAKE TEXTAFTER TEXTBEFORE TEXTJOIN TEXTSPLIT TOCOL TOROW TRIMRANGE UNICHAR UNICODE
UNIQUE VALUETOTEXT VAR.P VAR.S VSTACK WEBSERVICE WEIBULL.DIST WORKDAY.INTL WRAPCOLS WRAPROWS
XLOOKUP XMATCH XOR Z.TEST`
    .split(/\s+/)
    .map((name): [string, string] => [name, "_xlfn."]),
  ["FILTER", "_xlfn._xlws."],
  ["SORT", "_xlfn._xlws."],
]);

/** Excel's stored formula text (no `=`) to the text the spreadsheet engine reads. */
export function fromExcelFormula(text: string): string {
  return outsideStrings(text, (code) => code.replace(/\b_xl(?:fn|ws)\./gi, ""));
}

/** A formula as typed (with or without `=`) to Excel's stored formula text. */
export function toExcelFormula(formula: string): string {
  return outsideStrings(formula.replace(/^=/, ""), (code) =>
    code.replace(/(^|[^\w.])([A-Za-z][\w.]*)(?=\()/g, (match, before: string, name: string) => {
      const prefix = FUTURE_FUNCTIONS.get(name.toUpperCase());
      return prefix ? `${before}${prefix}${name}` : match;
    }),
  );
}
