// AUTHORED-BY Codex GPT-6.1-Sol
// AUTHORED-BY Codex GPT-6
// AUTHORED-BY Claude Opus 5.5
// Types local to the profiler. The output contract (SiteModel and friends) lives in @jeswr/site-model.

import type { ExecutorOptions } from "@jeswr/site-executor";
import type { CsrfRule, EffectClass, LearnMethod, SiteModel } from "@jeswr/site-model";
import type { Browser, Page } from "playwright";

/** Which profiling step issued (or observed) a request. */
export type Phase = "login" | "crawl" | "probe" | "demonstration" | "verify";

/** One request the profiler saw, with credentials removed. */
export interface RecordedRequest {
  seq: number;
  phase: Phase;
  /** Name of the demonstration running when this was recorded. */
  demonstration?: string;
  method: string;
  url: string;
  /** Playwright resource type (document, xhr, fetch, script, ...) or 'replay' for profiler replays. */
  resourceType: string;
  /** Request headers, lower-cased, without cookie, authorization or proxy-authorization. */
  requestHeaders: Record<string, string>;
  /** Names (never values) of the cookies sent. */
  cookieNames: string[];
  /** Request headers whose value equalled a cookie's value: header name (lower case) -> cookie name. */
  headersFromCookies?: Record<string, string>;
  /** Authorization scheme sent (e.g. 'Bearer'), never the credential. */
  authScheme?: string;
  postData?: string;
  /** Request bodies are bounded independently of response samples. Incomplete bodies cannot teach writes. */
  postDataTruncated?: boolean;
  postDataUnsupported?: boolean;
  /** Body field -> matching cookie name; values never retained. */
  bodyFromCookies?: Record<string, string>;
  status?: number;
  contentType?: string;
  /** Location header of a redirect response. */
  redirectedTo?: string;
  /** Exact recorder sequence of the request whose redirect caused this request. */
  redirectedFrom?: number;
  /** Names of the cookies the response set. */
  setCookieNames?: string[];
  /** Response body, truncated to the profiler's sample limit. */
  bodySample?: string;
  bodyTruncated?: boolean;
  /** Error/validation check over the complete witnessed response, before sample truncation. */
  responsePageError?: boolean;
  /** Complete-response failure check excluding neutral flash regions. */
  responsePageFailure?: boolean;
  /** Hashes of the complete response's flash regions, never executable text. */
  responseFlash?: string[];
  /** True when the profiler's guard refused to send it (a non-GET outside demonstrations and login). */
  blocked?: boolean;
}

/** A field of an HTML form. */
export interface FormField {
  name: string;
  /** input type, or 'select' / 'textarea'. */
  type: string;
  value?: string;
  required: boolean;
  hidden: boolean;
  options?: string[];
  /** The option selected when the page loads (selects only). */
  selected?: string;
  label?: string;
}

export interface FormInfo {
  /** URL of the page the form is on. */
  pageUrl: string;
  method: "GET" | "POST";
  /** Absolute action URL. */
  action: string;
  enctype: "application/x-www-form-urlencoded" | "multipart/form-data";
  /** CSS selector that finds this form on its page. */
  selector: string;
  fields: FormField[];
  hasPassword: boolean;
  /** Text of submit buttons. */
  submitLabels: string[];
}

/** A request a script would make, found by static analysis. */
export interface ScriptCall {
  scriptUrl: string;
  method: string;
  /** Absolute URL with {name} placeholders for the dynamic parts, query included. */
  urlPattern: string;
  /** Static headers (credentials excluded). */
  headers: Record<string, string>;
  csrf: CsrfRule[];
  bodyKind?: "json" | "form" | "multipart" | "text";
  bodyKeys: string[];
  authScheme?: string;
  via: string;
  line: number;
}

export type ParamKind = "numeric" | "uuid" | "sku" | "known-id" | "text";

export interface CandidateParam {
  name: string;
  location: "path" | "query" | "body" | "form";
  /** Values from this endpoint's successful requests or own form, in order, deduplicated. */
  examples: string[];
  required: boolean;
  kind?: ParamKind;
  /** JSON type of a body value. */
  jsonType?: "string" | "integer" | "number" | "boolean" | "object" | "array" | "null";
  options?: string[];
  /** Initially selected value of a form select. */
  selected?: string;
  hidden?: boolean;
  formType?: string;
}

/** A cluster of requests (or a form, or a script call) that hit one endpoint. */
export interface EndpointCandidate {
  /** METHOD + space + urlTemplate with variable names erased; used to merge evidence. */
  key: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** RFC 6570, absolute, on the site origin. */
  urlTemplate: string;
  params: CandidateParam[];
  contentType?: "application/json" | "application/x-www-form-urlencoded" | "multipart/form-data";
  /** JSON body with "{name}" whole-value placeholders. */
  bodyTemplate?: string;
  headers: Record<string, string>;
  csrf: CsrfRule[];
  sources: LearnMethod[];
  samples: RecordedRequest[];
  responseKind: "json" | "html" | "other" | "unknown";
  form?: FormInfo;
  script?: ScriptCall;
  authScheme?: string;
  /** A witnessed write whose required replay source is unavailable in the shared contract. */
  unsupported?: string;
}

/** What an endpoint does, in schema.org terms. */
export interface Label {
  actionType: string;
  label: string;
  effect: EffectClass;
  confidence: number;
  description?: string;
  /** Leave the endpoint out of the model (static asset, page with nothing to extract, ...). */
  skip?: boolean;
  reason?: string;
}

export interface Labeller {
  label(endpoint: EndpointCandidate): Promise<Label>;
}

/** A scripted session standing in for a person showing the agent a task once. */
export interface Demonstration {
  name: string;
  /** Short description used as the flow's description. */
  description?: string;
  run(page: Page): Promise<void>;
}

export interface ProfileOptions {
  startUrl: string;
  maxPages?: number;
  /** Hard deadline for the complete learning run. Default 180000 ms. */
  maxProfileMs?: number;
  /** Per-page navigation bound (default 15000 ms). */
  navigationTimeoutMs?: number;
  /** Post-navigation network-idle bound (default 5000 ms). */
  networkIdleTimeoutMs?: number;
  login?: { username: string; password: string };
  demonstrations?: Demonstration[];
  labeller?: Labeller;
  /** A browser to use; when omitted the profiler launches (and closes) headless Chromium. */
  browser?: Browser;
  now?: () => Date;
  /** IRI of the site model document; default urn:sab:model:<host>. */
  modelId?: string;
  /** Verify learned reads, with at most one retry using recorded successful values. Default true. */
  verify?: boolean;
  /** Version string for the model. Default 0.1.0. */
  version?: string;
}

export interface ProfileResult {
  model: SiteModel;
  /** Learned demonstration response policies; persist separately from model RDF. */
  writeResponses: NonNullable<ExecutorOptions["writeResponses"]>;
  trace: RecordedRequest[];
  warnings: string[];
}
