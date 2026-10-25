// Types mirroring the JSON contract of parallaxc / the FastAPI backend
// (docs/API_CONTRACT.md, schema_version 1).

export interface Position {
  offset: number; // UTF-8 byte offset
  line: number; // 1-based
  column: number; // 1-based, Unicode code points
}

export interface Token {
  index: number;
  kind: string;
  category: string;
  lexeme: string;
  start: Position;
  end: Position;
  value?: number | boolean;
  message?: string;
}

export interface CommentInfo {
  kind: "line" | "block";
  start: Position;
  end: Position;
}

export interface LexicalError {
  index: number;
  kind: "ERROR" | "UNSUPPORTED";
  lexeme: string;
  message: string;
  start: Position;
  end: Position;
}

export interface Diagnostic {
  token_index: number;
  unexpected: string;
  unexpected_lexeme: string;
  expected: string[];
  expected_spelling: string[];
  parser_state: number;
  message: string;
  bison_message: string;
  start: Position;
  end: Position;
}

export interface AstNode {
  kind: string;
  type?: string;
  name?: string;
  op?: string;
  value?: string;
  array?: string;
  span: { start: Position; end: Position; tokens: string };
  children: AstNode[];
}

export interface NameWarning {
  kind: string;
  name: string;
  message: string;
  start: Position;
  end: Position;
}

export interface InputInfo {
  bytes: number;
  lines: number;
  sha: string;
  crlf_line_breaks: number;
  tabs: number;
  non_ascii_bytes: number;
  final_newline: boolean;
}

export interface ParseSection {
  ok: boolean;
  accepted: boolean;
  resource_limit: boolean;
  diagnostics: Diagnostic[];
  ast: AstNode | null;
  recovered_ast: AstNode | null;
  ast_hash?: string;
  ast_nodes?: number;
  ast_depth?: number;
  ast_text?: string;
  name_warnings?: NameWarning[];
  trace?: string[];
  trace_truncated?: boolean;
}

export interface StateItem {
  rule: number;
  lhs: string;
  rhs: string;
}
export interface ParserStateInfo {
  number: number;
  items: StateItem[];
  actions: { on: string; action: string }[];
  actions_truncated: boolean;
}

export interface LexDoc {
  schema_version: string;
  mode: "lex";
  input: InputInfo;
  tokens: Token[];
  comments: CommentInfo[];
  eof: Position;
  lexical_errors: LexicalError[];
  timing_ms: Record<string, number>;
}

export interface AnalyzeDoc extends Omit<LexDoc, "mode"> {
  mode: "analyze";
  parse: ParseSection;
  parser_state_info: ParserStateInfo | null;
  grammar_report_available: boolean;
}

export interface Edit {
  op: "insert" | "delete" | "replace";
  kind?: string;
  text?: string;
  placeholder?: boolean;
  removed_kind?: string;
  removed_text?: string;
  stream_pos: number;
  anchor_token: number;
  at: Position;
  cost: number;
  generator: string;
  support: string;
}

export interface Evidence {
  name: string;
  group: string;
  value: number;
  weight: number;
  contribution: number;
  explanation: string;
}

export interface ErrorRef {
  token_index: number;
  token: string;
  at: Position;
}

export interface Candidate {
  id: number;
  rank: number;
  class_id: number;
  outcome: string;
  reason: string;
  summary: string;
  cost: number;
  score: number;
  local_score: number;
  valid: boolean;
  roundtrip_ok: boolean;
  progress: number;
  edits: Edit[];
  source: string;
  ast_hash: string;
  next_error: ErrorRef | null;
  residual_diagnostics: { message: string; original: ErrorRef }[];
  name_warnings: NameWarning[];
  evidence: Evidence[];
  ast?: AstNode;
}

export interface RejectedCandidate {
  id: number;
  outcome: string;
  reason: string;
  summary: string;
  cost: number;
  edits: Edit[];
  next_error: ErrorRef | null;
}

export interface CandidateClass {
  id: number;
  ast_hash: string;
  complete_ast: boolean;
  size: number;
  best_score: number;
  min_cost: number;
  representative: number;
  members: number[];
}

export interface LaneStep {
  depth: number;
  summary: string;
  alternatives: number;
  margin: number | null;
  error: ErrorRef;
  error_kind: string;
  edits: Edit[];
}

export interface LaneLeaf {
  id: number;
  root_class: number;
  valid: boolean;
  stop_reason: string;
  total_cost: number;
  score_sum: number;
  steps: LaneStep[];
  source: string;
}

export interface StabilityEntry {
  token_index: number;
  token: string;
  hypotheses_with: number;
  hypotheses_total: number;
  stable: boolean;
  at: Position;
}

export interface Plan {
  leaf: number;
  root_class: number;
  valid: boolean;
  total_cost: number;
  summary: string;
  source: string;
  edits: Edit[];
  tokens: string[];
  ast_hash?: string;
  ast?: AstNode;
}

export type DecisionStatus =
  | "NO_REPAIR_NEEDED"
  | "RECOMMENDED"
  | "MULTIPLE_PLAUSIBLE"
  | "LOW_CONFIDENCE"
  | "NO_SAFE_REPAIR"
  | "BUDGET_EXHAUSTED"
  | "UNSUPPORTED_CONSTRUCT";

export interface Stage {
  name: string;
  status: string;
  ms: number;
  detail: string;
}

export interface RepairSection {
  config: Record<string, string | number | boolean>;
  error_site: (ErrorRef & { kind: string; start: Position; end: Position; expected: string[]; parser_state?: number; message?: string }) | null;
  stages: Stage[];
  counts: { generated: number; single_edit: number; two_edit: number; accepted: number; classes: number; by_outcome: Record<string, number> };
  candidates: Candidate[];
  candidates_truncated: boolean;
  rejected: RejectedCandidate[];
  classes: CandidateClass[];
  hypotheses: { truncated: boolean; leaves: LaneLeaf[]; stability: StabilityEntry[] };
  decision: {
    status: DecisionStatus;
    summary: string;
    reasons: string[];
    margin: number | null;
    tau: number;
    recommended_leaf: number;
    plans: Plan[];
  };
  budget: { parser_invocations: number; max_parser_invocations: number; elapsed_ms: number; time_limit_ms: number; exhausted: boolean };
}

export interface RepairDoc extends Omit<AnalyzeDoc, "mode"> {
  mode: "repair";
  repair: RepairSection;
  tau_source?: string;
}

export interface Envelope<T> {
  run_id: string;
  kind: string;
  api_version: string;
  input_sha256: string | null;
  backend_ms: number;
  compiler_ms: number | null;
  data: T;
}

export interface ApiErrorBody {
  run_id?: string;
  error: { code: string; message: string; hint?: string | null; details?: unknown };
}

export interface Example {
  id: string;
  title: string;
  category: string;
  description: string;
  why: string;
  expected_status: DecisionStatus;
  source: string;
}

export interface Health {
  status: "ok" | "degraded";
  api_version: string;
  compiler: { available: boolean; binary: string; version: string | null };
  hint: string | null;
}

export interface Capabilities {
  api_version: string;
  compiler_available: boolean;
  compiler_version: string | null;
  limits: { max_input_bytes: number; timeout_s: number; max_concurrency: number; max_nesting: number };
  grammar_report_available: boolean;
  evaluation_results_available: boolean;
  optional_baselines: { cpctplus: { available: boolean; reason: string | null; tool?: string; tested_version?: string } };
}

export interface CompareResult {
  before: { ok: boolean; ast: AstNode | null; ast_hash?: string; diagnostics: string[] };
  after: { ok: boolean; ast: AstNode | null; ast_hash?: string; diagnostics: string[] };
  comparable: boolean;
  equivalent: boolean;
  changes: { change: string; path: string; before: string | null; after: string | null; detail: string; before_span?: AstNode["span"] | null; after_span?: AstNode["span"] | null }[];
  rule: string;
}

export interface GrammarInfo {
  grammar_source: string;
  rules: { number: number; lhs: string; rhs: string }[];
  states: number | null;
  report_available: boolean;
  note: string;
  lexer_source?: string;
}

export interface RepairOptions {
  strategy: "parallax" | "least-cost";
  grouping: boolean;
  stability: boolean;
  abstention: boolean;
  layout: boolean;
  tau?: number | null;
}
