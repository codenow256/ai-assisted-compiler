// Typed client for the IntelliFix FastAPI backend. Every call has a timeout,
// can be aborted (stale-request handling), and failures become ApiError
// values with a stable `code` so the UI can explain them precisely.
import type {
  AnalyzeDoc,
  ApiErrorBody,
  Capabilities,
  CompareResult,
  Envelope,
  Example,
  GrammarInfo,
  Health,
  LexDoc,
  RepairDoc,
  RepairOptions,
} from "../types/api";

export type ApiErrorCode =
  | "BACKEND_UNAVAILABLE"
  | "TIMEOUT"
  | "ABORTED"
  | "COMPILER_UNAVAILABLE"
  | "COMPILER_TIMEOUT"
  | "COMPILER_FAILURE"
  | "INPUT_TOO_LARGE"
  | "INVALID_REQUEST"
  | "MALFORMED_JSON"
  | "BACKEND_FAILURE"
  | string;

export class ApiError extends Error {
  constructor(
    public code: ApiErrorCode,
    message: string,
    public hint: string | null = null,
    public status = 0,
  ) {
    super(message);
  }
}

const BASE = "/api";
const DEFAULT_TIMEOUT_MS = 30_000;

async function request<T>(path: string, init: RequestInit & { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<T> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort("timeout"), init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const outer = init.signal;
  const onOuterAbort = () => ctrl.abort("aborted");
  outer?.addEventListener("abort", onOuterAbort);
  let resp: Response;
  try {
    resp = await fetch(BASE + path, { ...init, signal: ctrl.signal, headers: { "Content-Type": "application/json", ...(init.headers ?? {}) } });
  } catch (e) {
    if (ctrl.signal.aborted) {
      if (ctrl.signal.reason === "timeout") throw new ApiError("TIMEOUT", "The request timed out before the backend answered.");
      throw new ApiError("ABORTED", "The request was cancelled because a newer one replaced it.");
    }
    throw new ApiError(
      "BACKEND_UNAVAILABLE",
      "Cannot reach the IntelliFix backend.",
      "Start it with: cd parallax/backend && uvicorn app.main:app --port 8000",
    );
  } finally {
    clearTimeout(timeout);
    outer?.removeEventListener("abort", onOuterAbort);
  }
  let body: unknown;
  try {
    body = await resp.json();
  } catch {
    throw new ApiError("BACKEND_FAILURE", `The backend answered with a non-JSON response (HTTP ${resp.status}).`, null, resp.status);
  }
  if (!resp.ok) {
    const err = (body as ApiErrorBody)?.error;
    throw new ApiError(err?.code ?? "BACKEND_FAILURE", err?.message ?? `HTTP ${resp.status}`, err?.hint ?? null, resp.status);
  }
  return body as T;
}

const post = <T>(path: string, payload: unknown, signal?: AbortSignal, timeoutMs?: number) =>
  request<T>(path, { method: "POST", body: JSON.stringify(payload), signal, timeoutMs });

export const api = {
  health: () => request<Health>("/health", { timeoutMs: 5000 }),
  capabilities: () => request<Capabilities>("/capabilities", { timeoutMs: 8000 }),
  examples: () => request<{ examples: Example[]; note: string }>("/examples"),
  lex: (source: string, signal?: AbortSignal) => post<Envelope<LexDoc>>("/lex", { source }, signal),
  parse: (source: string, trace: boolean, signal?: AbortSignal) => post<Envelope<AnalyzeDoc>>("/parse", { source, trace }, signal),
  repair: (source: string, options: RepairOptions, signal?: AbortSignal) =>
    post<Envelope<RepairDoc>>("/repair", { source, options: cleanOptions(options) }, signal),
  compare: (before: string, after: string, signal?: AbortSignal) => post<Envelope<CompareResult>>("/repair/compare", { before, after }, signal),
  grammar: () => request<GrammarInfo>("/grammar"),
  evaluationResults: () => request<EvaluationResultsResponse>("/evaluation/results"),
  evaluationCase: (id: string) => request<EvaluationCase>(`/evaluation/case/${encodeURIComponent(id)}`),
  evaluate: (split: "dev" | "test", limit: number, seed: number) =>
    post<Envelope<LiveEvaluation>>("/evaluate", { split, limit, seed }, undefined, 120_000),
  docs: () => request<{ docs: { name: string; title: string }[] }>("/docs"),
  doc: (name: string) => request<{ name: string; markdown: string }>(`/docs/${encodeURIComponent(name)}`),
};

function cleanOptions(o: RepairOptions) {
  const out: Record<string, unknown> = {
    strategy: o.strategy,
    grouping: o.grouping,
    stability: o.stability,
    abstention: o.abstention,
    layout: o.layout,
  };
  if (o.tau !== undefined && o.tau !== null && Number.isFinite(o.tau)) out.tau = o.tau;
  return out;
}

// Evaluation payloads are large and mostly rendered generically; keep them loose.
export interface EvaluationResultsResponse {
  summary: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  report_markdown: string | null;
  provenance: { file: string; generated_utc: string; git_commit: string; kind: string };
}

export interface EvaluationCase {
  id: string;
  family: string;
  split: string;
  category: string;
  ambiguity: string;
  edits: { op: string; category: string; removed: string | null; inserted: string | null; line: number; column: number }[];
  original: string;
  corrupted: string;
  n_errors: number;
}

export interface LiveEvaluation {
  kind: string;
  split: string;
  n: number;
  seed: number;
  tau: number;
  systems: { id: string; name: string }[];
  metrics: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  seconds: number;
  case_ids: string[];
}
