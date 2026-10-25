// Global project state: the source under investigation, the latest real
// compiler results for it, and the history of accepted repairs.
//
// Stale-response safety: each kind of request carries a sequence number and
// an AbortController; a response is applied only if it belongs to the newest
// request of its kind. Every result stores the exact source it was computed
// for, so views can flag results that no longer match the editor.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ApiError, api } from "../services/api";
import type { AnalyzeDoc, Capabilities, Diagnostic, Edit, Envelope, Example, Health, LexDoc, RepairDoc, RepairOptions } from "../types/api";

export type RunKind = "lex" | "parse" | "repair";

export interface RunResult<T> {
  envelope: Envelope<T>;
  source: string;
  at: number;
}

export interface SourceOrigin {
  kind: "example" | "file" | "user" | "repair" | "case" | "empty";
  label: string;
  exampleId?: string;
}

export interface Highlight {
  from: number; // UTF-8 byte offsets
  to: number;
  label?: string;
  tone?: "error" | "select" | "edit";
}

export interface HistoryEntry {
  source: string;
  origin: SourceOrigin;
  reason: string;
  /** real parser diagnostics of `source` (if it had been parsed), for before/after verification */
  diagnostics: Diagnostic[] | null;
}

/** A fix the user has chosen but not applied yet (shared by the Workspace and the AST explorer). */
export interface Proposal {
  source: string; // the full repaired program
  forSource: string; // the code it repairs
  label: string; // plain words, e.g. "insert ; at 3:16"
  kind: "recommended" | "plan" | "answer";
  edits: Edit[]; // engine edits (empty for a user-typed answer)
  /** result of a real parse of `source`: true = accepted */
  parses: boolean;
}

export const DEFAULT_OPTIONS: RepairOptions = {
  strategy: "parallax",
  grouping: true,
  stability: true,
  abstention: true,
  layout: true,
  tau: null,
};

interface ProjectState {
  source: string;
  origin: SourceOrigin;
  baseline: string; // source as originally loaded (for "reset")
  setSource: (s: string, origin?: SourceOrigin) => void;
  loadSource: (s: string, origin: SourceOrigin) => void;
  resetSource: () => void;
  lex: RunResult<LexDoc> | null;
  parse: RunResult<AnalyzeDoc> | null;
  repair: RunResult<RepairDoc> | null;
  running: Record<RunKind, boolean>;
  errors: Partial<Record<RunKind, ApiError>>;
  runLex: () => Promise<void>;
  runParse: (trace?: boolean) => Promise<void>;
  runRepair: () => Promise<void>;
  runAll: () => Promise<void>;
  options: RepairOptions;
  setOptions: (o: RepairOptions) => void;
  applyRepair: (newSource: string, reason: string, opts?: { reanalyze?: boolean }) => void;
  undo: (opts?: { reanalyze?: boolean }) => void;
  history: HistoryEntry[];
  proposal: Proposal | null;
  setProposal: (p: Proposal | null) => void;
  highlight: Highlight | null;
  setHighlight: (h: Highlight | null) => void;
  examples: Example[];
  examplesError: ApiError | null;
  health: Health | null;
  healthError: ApiError | null;
  capabilities: Capabilities | null;
  refreshHealth: () => Promise<void>;
  isStale: (r: { source: string } | null) => boolean;
  lastRunAt: number | null;
}

const Ctx = createContext<ProjectState | null>(null);

export function useProject(): ProjectState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProject must be used inside <ProjectProvider>");
  return v;
}

const STARTER = `// Pick a sample from the menu above, or write MiniC here.
int main() {
  int x = 1
  return x;
}
`;

const DRAFT_KEY = "parallax-draft";

/** The editor draft survives a page refresh (browser storage, best effort). */
function loadDraft(): { source: string; origin: SourceOrigin } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const d = JSON.parse(raw);
    return typeof d?.source === "string" && d.origin?.label ? d : null;
  } catch {
    return null;
  }
}

export function ProjectProvider({ children, initialSource }: { children: ReactNode; initialSource?: string }) {
  const [draft] = useState(() => (initialSource === undefined ? loadDraft() : null));
  const [source, setSourceState] = useState(initialSource ?? draft?.source ?? STARTER);
  const [origin, setOrigin] = useState<SourceOrigin>(draft?.origin ?? { kind: "user", label: "untitled.mc" });
  const [baseline, setBaseline] = useState(initialSource ?? draft?.source ?? STARTER);
  const [lex, setLex] = useState<RunResult<LexDoc> | null>(null);
  const [parse, setParse] = useState<RunResult<AnalyzeDoc> | null>(null);
  const [repair, setRepair] = useState<RunResult<RepairDoc> | null>(null);
  const [running, setRunning] = useState<Record<RunKind, boolean>>({ lex: false, parse: false, repair: false });
  const [errors, setErrors] = useState<Partial<Record<RunKind, ApiError>>>({});
  const [options, setOptions] = useState<RepairOptions>(DEFAULT_OPTIONS);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [highlight, setHighlight] = useState<Highlight | null>(null);
  const [examples, setExamples] = useState<Example[]>([]);
  const [examplesError, setExamplesError] = useState<ApiError | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthError, setHealthError] = useState<ApiError | null>(null);
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);

  const seq = useRef<Record<RunKind, number>>({ lex: 0, parse: 0, repair: 0 });
  const ctrls = useRef<Partial<Record<RunKind, AbortController>>>({});
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (initialSource !== undefined) return; // tests / embedded use: no persistence
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ source, origin }));
      } catch {
        /* storage unavailable: the draft simply is not kept */
      }
    }, 400);
    return () => clearTimeout(t);
  }, [source, origin, initialSource]);

  const refreshHealth = useCallback(async () => {
    try {
      setHealth(await api.health());
      setHealthError(null);
      api.capabilities().then(setCapabilities).catch(() => setCapabilities(null));
    } catch (e) {
      setHealth(null);
      setHealthError(e instanceof ApiError ? e : new ApiError("BACKEND_UNAVAILABLE", String(e)));
    }
  }, []);

  useEffect(() => {
    refreshHealth();
    api
      .examples()
      .then((r) => {
        setExamples(r.examples);
        setExamplesError(null);
      })
      .catch((e) => setExamplesError(e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e))));
  }, [refreshHealth]);

  const setSource = useCallback((s: string, o?: SourceOrigin) => {
    setSourceState(s);
    if (o) setOrigin(o);
  }, []);

  const loadSource = useCallback((s: string, o: SourceOrigin) => {
    // Loading a new program cancels in-flight runs and clears old results.
    (Object.keys(ctrls.current) as RunKind[]).forEach((k) => ctrls.current[k]?.abort());
    setSourceState(s);
    setOrigin(o);
    setBaseline(s);
    setHistory([]);
    setProposal(null);
    setLex(null);
    setParse(null);
    setRepair(null);
    setErrors({});
    setHighlight(null);
    setRunning({ lex: false, parse: false, repair: false });
  }, []);

  const resetSource = useCallback(() => {
    setSourceState(baseline);
    setHighlight(null);
  }, [baseline]);

  const run = useCallback(async <T,>(kind: RunKind, fn: (src: string, signal: AbortSignal) => Promise<Envelope<T>>, set: (r: RunResult<T>) => void) => {
    const id = ++seq.current[kind];
    ctrls.current[kind]?.abort();
    const ctrl = new AbortController();
    ctrls.current[kind] = ctrl;
    const src = sourceRef.current;
    setRunning((r) => ({ ...r, [kind]: true }));
    setErrors((e) => ({ ...e, [kind]: undefined }));
    try {
      const envelope = await fn(src, ctrl.signal);
      if (id !== seq.current[kind]) return; // a newer request superseded this one
      set({ envelope, source: src, at: Date.now() });
      setLastRunAt(Date.now());
    } catch (e) {
      if (id !== seq.current[kind]) return;
      const err = e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e));
      if (err.code !== "ABORTED") setErrors((x) => ({ ...x, [kind]: err }));
      if (err.code === "BACKEND_UNAVAILABLE") setHealth(null);
    } finally {
      if (id === seq.current[kind]) setRunning((r) => ({ ...r, [kind]: false }));
    }
  }, []);

  const runLex = useCallback(() => run<LexDoc>("lex", (s, sig) => api.lex(s, sig), setLex), [run]);
  const runParse = useCallback(
    (trace = true) => run<AnalyzeDoc>("parse", (s, sig) => api.parse(s, trace, sig), setParse),
    [run],
  );
  const runRepair = useCallback(
    () => run<RepairDoc>("repair", (s, sig) => api.repair(s, optionsRef.current, sig), setRepair),
    [run],
  );
  const runAll = useCallback(async () => {
    await Promise.all([runLex(), runParse(true), runRepair()]);
  }, [runLex, runParse, runRepair]);

  const applyRepair = useCallback(
    (newSource: string, reason: string, opts?: { reanalyze?: boolean }) => {
      const before = sourceRef.current;
      const diagnostics = parseRef.current && parseRef.current.source === before ? parseRef.current.envelope.data.parse.diagnostics : null;
      setHistory((h) => [...h, { source: before, origin, reason, diagnostics }]);
      setProposal(null);
      setSourceState(newSource);
      sourceRef.current = newSource; // so an immediate re-analysis runs on the new text
      setOrigin((o) => ({ ...o, kind: "repair", label: o.label.replace(/( \(repaired\))?$/, " (repaired)") }));
      setHighlight(null);
      if (opts?.reanalyze) void Promise.all([runLex(), runParse(true), runRepair()]);
    },
    [origin, runLex, runParse, runRepair],
  );

  const historyRef = useRef(history);
  historyRef.current = history;
  const undo = useCallback(
    (opts?: { reanalyze?: boolean }) => {
      const h = historyRef.current;
      if (!h.length) return;
      const last = h[h.length - 1];
      setHistory(h.slice(0, -1));
      setSourceState(last.source);
      sourceRef.current = last.source;
      setOrigin(last.origin);
      setProposal(null);
      setHighlight(null);
      if (opts?.reanalyze) void Promise.all([runLex(), runParse(true), runRepair()]);
    },
    [runLex, runParse, runRepair],
  );

  const isStale = useCallback((r: { source: string } | null) => !!r && r.source !== source, [source]);

  const value = useMemo<ProjectState>(
    () => ({
      source,
      origin,
      baseline,
      setSource,
      loadSource,
      resetSource,
      lex,
      parse,
      repair,
      running,
      errors,
      runLex,
      runParse,
      runRepair,
      runAll,
      options,
      setOptions,
      applyRepair,
      undo,
      history,
      proposal,
      setProposal,
      highlight,
      setHighlight,
      examples,
      examplesError,
      health,
      healthError,
      capabilities,
      refreshHealth,
      isStale,
      lastRunAt,
    }),
    [source, origin, baseline, setSource, loadSource, resetSource, lex, parse, repair, running, errors, runLex, runParse, runRepair, runAll, options, applyRepair, undo, history, proposal, highlight, examples, examplesError, health, healthError, capabilities, refreshHealth, isStale, lastRunAt],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
