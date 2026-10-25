import { Check, CircleHelp, Lightbulb, ListTree, MapPin, Undo2, X } from "lucide-react";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useProject } from "../app/ProjectContext";
import { explain, spliceBytes, type ClarifyOption, type Explanation } from "../lib/explain";
import { ApiError, api } from "../services/api";
import type { AnalyzeDoc, RepairDoc } from "../types/api";
import { SourceDiff } from "./SourceDiff";
import { Badge, Banner, Disclosure, ErrorBanner, Spinner } from "./ui";

/** Renders `code` and **bold** in explanation strings (text only, no HTML). */
export function Rich({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return (
    <>
      {parts.map((s, i) =>
        s.startsWith("`") && s.endsWith("`") && s.length > 1 ? <code key={i}>{s.slice(1, -1)}</code> : s.startsWith("**") && s.endsWith("**") && s.length > 4 ? <strong key={i}><Rich text={s.slice(2, -2)} /></strong> : <Fragment key={i}>{s}</Fragment>,
      )}
    </>
  );
}

const TONE_TITLE: Record<string, string> = { success: "Result", warning: "What IntelliFix found", danger: "What went wrong", info: "What IntelliFix found", neutral: "Result" };

/**
 * The plain-language answer for the current analysis. Uses the repair result
 * when it matches the editor, otherwise the parse result.
 */
export function ExplainPanel() {
  const p = useProject();
  // Newest result: the repair run when it matches the parse run, else whichever is newer.
  const run = (() => {
    const r = p.repair, a = p.parse;
    if (r && (!a || a.source === r.source || r.at >= a.at)) return { doc: r.envelope.data as RepairDoc | AnalyzeDoc, source: r.source };
    return a ? { doc: a.envelope.data as RepairDoc | AnalyzeDoc, source: a.source } : null;
  })();
  const doc = run?.doc ?? null;
  const source = run?.source ?? p.source;
  const stale = !!run && run.source !== p.source;
  const ex = useMemo(() => (doc ? explain(doc, source) : null), [doc, source]);
  const [practice, setPractice] = useState<{ line: number; source: string } | null>(null);
  const [hintLevel, setHintLevel] = useState(0);
  useEffect(() => setHintLevel(0), [ex?.location?.from, ex?.headline]);

  if (!doc || !ex) return null;
  const progress = practice && p.parse && !p.isStale(p.parse) && p.parse.source !== practice.source ? practiceResult(practice.line, doc) : null;

  return (
    <section className={`explain explain-${ex.tone}`} aria-label="Explanation" data-testid="explanation">
      {stale && (
        <Banner tone="neutral" title="You changed the code since this explanation">
          It describes the earlier text. Press <strong>{practice ? "Check my fix" : "Analyze"}</strong> to update it.
        </Banner>
      )}
      <div className="explain-head">
        <span className="tiny muted">{TONE_TITLE[ex.tone]}</span>
        <h3><Rich text={ex.headline} /></h3>
      </div>
      {ex.paragraphs.map((t, i) => <p key={i} className="small"><Rich text={t} /></p>)}
      {ex.location && !stale && (
        <button className="loc" onClick={() => p.setHighlight({ from: ex.location!.from, to: ex.location!.to, tone: "error" })} title="Highlight in the editor">
          <MapPin size={13} aria-hidden /> line {ex.location.line}, column {ex.location.column}: <code>{ex.location.lineText.trim() || "(empty line)"}</code>
        </button>
      )}
      {ex.expected && <p className="small"><strong>Expected here:</strong> <Rich text={ex.expected} /></p>}
      {ex.facts && ex.facts.length > 0 && (
        <div className="small"><strong>What your program contains</strong>
          <ul className="hint-list">{ex.facts.map((f) => <li key={f}><Rich text={f} /></li>)}</ul>
          <Link className="btn sm" to="/ast"><ListTree size={13} aria-hidden /> Explore the AST</Link>
        </div>
      )}
      {ex.unknowns && <ul className="hint-list tiny muted">{ex.unknowns.map((u) => <li key={u}>{u}</li>)}</ul>}
      {ex.cascade && (
        <Disclosure summary={`Several errors reported (${ex.cascade.total}) — which one to fix first?`} open>
          <ul className="hint-list small">{ex.cascade.lines.map((l) => <li key={l}><Rich text={l} /></li>)}</ul>
        </Disclosure>
      )}
      {ex.question && <ClarifyCard question={ex.question} doc={doc as RepairDoc} />}
      {ex.hints && (
        <div className="hints">
          <div className="row">
            <strong className="small"><Lightbulb size={13} aria-hidden /> Want to fix it yourself?</strong>
            {hintLevel < ex.hints.length && <button className="btn sm" onClick={() => setHintLevel((h) => h + 1)}>{hintLevel === 0 ? "Show a hint" : "Next hint"} ({hintLevel + 1}/{ex.hints.length})</button>}
            {!practice && <button className="btn sm" onClick={() => setPractice({ line: ex.location?.line ?? 1, source })}>I'll try it in the editor</button>}
          </div>
          {hintLevel > 0 && <ol className="hint-steps small">{ex.hints.slice(0, hintLevel).map((h, i) => <li key={i}><Rich text={h} /></li>)}</ol>}
        </div>
      )}
      {practice && (
        <div className="hints small" data-testid="practice">
          <p>Edit the code on the left, then press <strong>Check my fix</strong>. The real parser checks it.</p>
          <div className="row">
            <button className="btn primary sm" onClick={p.runAll} disabled={p.source === practice.source || p.running.parse}>Check my fix</button>
            <button className="btn sm" onClick={() => setPractice(null)}>Stop practising</button>
          </div>
          {progress && <Banner tone={progress.tone} title={progress.title}>{progress.body}</Banner>}
        </div>
      )}
      <div className="next small"><strong>What you can do next:</strong> {ex.nextSteps.map((s, i) => <span key={i}><Rich text={s} />{i < ex.nextSteps.length - 1 ? " " : ""}</span>)}</div>
    </section>
  );
}

function practiceResult(oldLine: number, doc: RepairDoc | AnalyzeDoc): { tone: "success" | "info" | "warning"; title: string; body: string } {
  if (doc.parse.ok) return { tone: "success", title: "Your fix works: the program now parses.", body: "The parser accepts every token. Check that the program still means what you intended." };
  const d = doc.parse.diagnostics[0];
  if (d.start.line > oldLine) return { tone: "info", title: `Progress: the error on line ${oldLine} is gone.`, body: `The next problem is on line ${d.start.line}: ${d.message}.` };
  return { tone: "warning", title: "Not fixed yet.", body: `The parser still stops at line ${d.start.line}, column ${d.start.column}: ${d.message}.` };
}

/** Feature A: ask what the user meant; options are real candidates or a user-typed fill-in, validated by the parser. */
function ClarifyCard({ question, doc }: { question: NonNullable<Explanation["question"]>; doc: RepairDoc }) {
  const p = useProject();
  const [choice, setChoice] = useState<string>("");
  const [text, setText] = useState("");
  const [check, setCheck] = useState<{ source: string; ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [resolved, setResolved] = useState<"left" | null>(null);
  useEffect(() => { setChoice(""); setText(""); setCheck(null); setResolved(null); }, [question]);
  const opt = question.options.find((o) => o.id === choice);

  const candidate = (o: ClarifyOption | undefined): string | null => {
    if (!o) return null;
    if (o.source) return o.source;
    if (o.fill && text.trim()) {
      const bytes = new TextEncoder().encode(p.source);
      const before = new TextDecoder().decode(bytes.slice(0, o.fill.at));
      const after = new TextDecoder().decode(bytes.slice(o.fill.at + o.fill.remove));
      const pad = before.length && !/\s$/.test(before) ? " " : "";
      const tail = after.length && !/^[\s;,)\]]/.test(after) ? " " : ""; // no stray space before ; , ) ]
      return spliceBytes(p.source, o.fill.at, o.fill.remove, pad + text.trim() + tail);
    }
    return null;
  };
  const proposed = candidate(opt);

  const validate = async () => {
    if (!proposed) return;
    setBusy(true); setErr(null);
    try {
      const r = (await api.parse(proposed, false)).data.parse;
      setCheck({ source: proposed, ok: r.ok, message: r.ok ? "The real parser accepts the whole program with this change." : `Still a syntax error at ${r.diagnostics[0].start.line}:${r.diagnostics[0].start.column}: ${r.diagnostics[0].message}. You can still apply it and continue.` });
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e)));
    } finally { setBusy(false); }
  };

  if (resolved === "left") return (
    <Banner tone="neutral" title="Left unresolved" actions={<button className="btn sm" onClick={() => setResolved(null)}>Reopen the question</button>}>Your code is unchanged. Edit it whenever you know what was meant.</Banner>
  );
  return (
    <div className="clarify" data-testid="clarify">
      <strong className="small"><CircleHelp size={14} aria-hidden /> IntelliFix needs your help: {question.text}</strong>
      <div className="stack" role="radiogroup" aria-label={question.text}>
        {question.options.map((o) => (
          <label key={o.id} className={`choice ${choice === o.id ? "on" : ""}`}>
            <input type="radio" name="clarify" checked={choice === o.id} onChange={() => { setChoice(o.id); setCheck(null); }} />
            <span><Rich text={o.label} /><span className="tiny muted block">{o.detail}</span></span>
          </label>
        ))}
      </div>
      {opt?.fill && (
        <div className="stack small">
          <label>Your {opt.fill.kind === "name" ? "name" : "value or expression"}: <input className="input sm" value={text} onChange={(e) => { setText(e.target.value); setCheck(null); }} placeholder={opt.fill.placeholder} aria-label="Missing code" /></label>
          {opt.fill.suggestions.length > 0 && (
            <div className="row tiny">Names declared earlier in your code:
              {opt.fill.suggestions.map((s) => <button key={s} className="btn sm chip" onClick={() => { setText(s); setCheck(null); }}>{s}</button>)}
            </div>
          )}
        </div>
      )}
      <div className="row">
        <button className="btn sm" onClick={validate} disabled={!proposed || busy}>Check with the parser</button>
        <button className="btn primary sm" disabled={!check || check.source !== proposed} onClick={() => { p.applyRepair(check!.source, `clarified: ${opt?.label ?? ""}`, { reanalyze: true }); }}>
          <Check size={13} aria-hidden /> Apply and re-analyze
        </button>
        <button className="btn sm" onClick={() => setResolved("left")}><X size={13} aria-hidden /> Leave it unresolved</button>
        {p.history.length > 0 && <button className="btn sm" onClick={p.undo}><Undo2 size={13} aria-hidden /> Undo</button>}
      </div>
      {busy && <Spinner label="Parsing…" />}
      {err && <ErrorBanner error={err} />}
      {check && check.source === proposed && <Banner tone={check.ok ? "success" : "warning"} title={check.ok ? "Valid MiniC" : "Not yet valid"}>{check.message}</Banner>}
      {proposed && <Disclosure summary="Preview the change"><SourceDiff before={p.source} after={proposed} maxHeight={200} /></Disclosure>}
      {doc.repair.decision.plans.length > 0 && <p className="tiny faint">Options come from the repair engine's real top-ranked plans; a fill-in is your own text. IntelliFix never invents a missing name or value.</p>}
    </div>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return <Badge tone="neutral" icon={false}>{children}</Badge>;
}
