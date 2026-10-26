// Step 3 — Fixes. Real candidates only: the engine's structurally different
// plans, compared side by side; when it abstains, a targeted question whose
// options are those plans, a fill-in, or the user's own version of the line,
// each validated by the real parser before it can be used.
import { Check, CircleHelp, PencilLine, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useProject, type Proposal } from "../../app/ProjectContext";
import { Rich } from "../../components/Rich";
import { Badge, Banner, Disclosure, ErrorBanner, Spinner } from "../../components/ui";
import { clarifyOptions, lineText, planRisks, planWords, spliceBytes, type ClarifyOption } from "../../lib/explain";
import { describeAmbiguity, differsFromTop, firstErrorView, planCards, replaceLine, unsupportedRewrite, type PlanCard, type Rewrite } from "../../lib/journey";
import { ApiError, api } from "../../services/api";
import type { RepairDoc } from "../../types/api";

/** A recommendation that removes code (operators, names, values, unsupported constructs) is shown as a question instead. */
function safeView(doc: RepairDoc): RepairDoc {
  const d = doc.repair.decision;
  if (d.status !== "RECOMMENDED" || !d.plans[0] || !planRisks(d.plans[0]).length) return doc;
  return { ...doc, repair: { ...doc.repair, decision: { ...d, status: "MULTIPLE_PLAUSIBLE", reasons: ["the top-ranked fix removes code, so IntelliFix asks instead of recommending it", ...d.reasons] } } };
}

export function Fixes({ doc, source, onChosen, onPractice }: { doc: RepairDoc; source: string; onChosen: () => void; onPractice: () => void }) {
  const p = useProject();
  const fe = useMemo(() => firstErrorView(doc, source), [doc, source]);
  const full = doc.repair.decision;
  const fullSafe = full.status === "RECOMMENDED" && !!full.plans[0] && !planRisks(full.plans[0]).length;
  const lexFirst = doc.lexical_errors.find((e) => e.start.offset === doc.parse.diagnostics[0]?.start.offset);
  const rewrite = unsupportedRewrite(source, lexFirst);
  const choose = (prop: Proposal) => { p.setProposal(prop); onChosen(); };
  if (doc.parse.ok) return <FixesBody doc={doc} source={source} onChosen={onChosen} onPractice={onPractice} />;
  if (!fe) return (
    <div className="stack-lg">
      {rewrite && <RewriteCard rewrite={rewrite} source={source} onUse={choose} />}
      <FixesBody doc={safeView(doc)} source={source} onChosen={onChosen} onPractice={onPractice} />
    </div>
  );
  const first = doc.parse.diagnostics[0];
  const intro = (
    <Banner tone="info" title={`Several errors: fix them one at a time (${fe.reported} reported now)`}>
      The parser reported {fe.reported} error(s). After the first one it skips ahead to recover, so some later reports may be side effects and further errors may only appear once earlier ones are fixed. IntelliFix therefore offers fixes for the <strong>first error</strong> (line {first?.start.line}, column {first?.start.column}). After you apply one, the whole program is analyzed again and you continue with the next error.
    </Banner>
  );
  if (fullSafe) return (
    <div className="stack-lg">
      <FixesBody doc={doc} source={source} onChosen={onChosen} onPractice={onPractice} />
      <Disclosure summary="Prefer to fix one error at a time? Options for the first error">
        <div className="stack">{intro}<FixesBody doc={safeView(fe.doc)} source={source} onChosen={onChosen} onPractice={onPractice} compact /></div>
      </Disclosure>
    </div>
  );
  const risks = fe.fullPlan ? planRisks(fe.fullPlan) : [];
  return (
    <div className="stack-lg">
      {intro}
      {rewrite && <RewriteCard rewrite={rewrite} source={source} onUse={choose} />}
      <FixesBody doc={safeView(fe.doc)} source={source} onChosen={onChosen} onPractice={onPractice} />
      {fe.fullPlan && (
        <Disclosure summary={`The engine's complete plan for all errors at once (${fe.fullPlan.edits.length} edits)${risks.length ? " — removes code, read before choosing" : ""}`}>
          <div className="stack small" data-testid="full-plan">
            <div><Rich text={planWords(fe.fullPlan)} /></div>
            {risks.length > 0 && <Banner tone="warning" title="This plan changes what your program does">It {risks.join("; it ")}. The parser accepts the result, but that does not mean it is what you intended. Status: {full.status === "RECOMMENDED" ? "recommended by the score" : "not recommended (the evidence does not single it out)"}.</Banner>}
            <div><button className="btn sm" onClick={() => choose({ source: fe.fullPlan!.source, forSource: source, label: planWords(fe.fullPlan!), kind: "plan", edits: fe.fullPlan!.edits, parses: fe.fullPlan!.valid })}>{risks.length ? "Choose it anyway (I understand it removes code)" : "Choose the complete plan"}</button></div>
          </div>
        </Disclosure>
      )}
    </div>
  );
}

/** Feature for unsupported C: a supported rewrite, validated by the real parser before it can be used. */
function RewriteCard({ rewrite, source, onUse }: { rewrite: Rewrite; source: string; onUse: (p: Proposal) => void }) {
  const [check, setCheck] = useState<{ ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const proposed = replaceLine(source, rewrite.line, rewrite.after);
  return (
    <div className="fix-card recommended" data-testid="rewrite">
      <div className="row"><Badge tone="info">Suggested rewrite</Badge><span className="small muted"><Rich text={rewrite.why} /></span></div>
      <div className="line-change mono"><span className="ln">{rewrite.line}</span><span className="was">{rewrite.before.trim()}</span><span className="arrow" aria-label="becomes">→</span><span className="now">{rewrite.after.trim()}</span></div>
      <div className="row">
        <button className="btn sm" disabled={busy} onClick={async () => {
          setBusy(true);
          try { const r = (await api.parse(proposed, false)).data.parse; const d = r.diagnostics[0]; setCheck({ ok: r.ok, msg: r.ok ? "The real parser accepts the whole program with this rewrite." : `The rewrite itself is accepted up to line ${d.start.line}; the parser now stops at ${d.start.line}:${d.start.column}: ${d.message}. You can still use it and continue with that error.` }); }
          catch (e) { setCheck({ ok: false, msg: e instanceof ApiError ? e.message : String(e) }); }
          finally { setBusy(false); }
        }}>Check with the parser</button>
        <button className="btn primary sm" disabled={!check} onClick={() => onUse({ source: proposed, forSource: source, label: `rewrite line ${rewrite.line} as \`${rewrite.after.trim()}\``, kind: "answer", edits: [], parses: !!check?.ok })}><Check size={13} aria-hidden /> Use this rewrite</button>
      </div>
      {busy && <Spinner label="Parsing…" />}
      {check && <Banner tone={check.ok ? "success" : "info"} title={check.ok ? "Valid MiniC" : "Rewrite accepted; another error follows"}>{check.msg}</Banner>}
    </div>
  );
}

function FixesBody({ doc, source, onChosen, onPractice }: { doc: RepairDoc; source: string; onChosen: () => void; onPractice: () => void; compact?: boolean }) {
  const p = useProject();
  const status = doc.repair.decision.status;
  const cards = useMemo(() => planCards(doc, source), [doc, source]);
  const choose = (prop: Proposal) => { p.setProposal(prop); onChosen(); };
  const fromCard = (c: PlanCard, kind: Proposal["kind"]): Proposal => ({ source: c.plan.source, forSource: source, label: c.words, kind, edits: c.plan.edits, parses: c.plan.valid });
  const unsupported = status === "UNSUPPORTED_CONSTRUCT";
  // Ask only when there is a real option to offer (plans that would delete code hidden in an
  // unterminated comment are never offered).
  const asks = (status === "MULTIPLE_PLAUSIBLE" || status === "LOW_CONFIDENCE") && cards.some((c) => !c.hidesCode);
  const firstLine = doc.parse.diagnostics[0]?.start.line ?? 1;

  if (doc.parse.ok && doc.parse.name_warnings?.length) return (
    <Banner tone="warning" title="No syntax fix needed, but a name problem remains">
      {doc.parse.name_warnings.map((w) => `${w.message} (line ${w.start.line}, column ${w.start.column})`).join("; ")}. Name problems are not syntax errors, so the repair engine does not change them: only you know which name you meant. Edit the code, then press Analyze.
    </Banner>
  );
  if (doc.parse.ok) return <Banner tone="success" title="No fix needed">The parser accepted the whole program, so there is nothing to repair. Continue to the tree to see its structure.</Banner>;

  return (
    <div className="stack-lg">
      {asks && cards.length > 0 && <ResolveAmbiguity doc={doc} source={source} onChoose={choose} />}
      {status === "RECOMMENDED" && cards[0] && (
        <div className="fix-card recommended" data-testid="recommended">
          <div className="row"><Badge tone="success">Recommended</Badge><span className="small muted">leads every structurally different alternative by {doc.repair.decision.margin === null ? "being the only one" : `a score gap of ${doc.repair.decision.margin.toFixed(2)} (threshold τ = ${doc.repair.decision.tau})`}</span></div>
          <PlanBody c={cards[0]} cards={cards} />
          <div className="row">
            <button className="btn primary sm" onClick={() => choose(fromCard(cards[0], "recommended"))}><Check size={13} aria-hidden /> Use this fix</button>
            <button className="btn sm" onClick={onPractice}><PencilLine size={13} aria-hidden /> I'd rather fix it myself</button>
          </div>
          <p className="tiny muted">“Parses” means the real parser accepts the repaired program. It does not prove the program means what you intended.</p>
        </div>
      )}
      {(!cards.length || unsupported || !asks && status !== "RECOMMENDED") && (
        <Banner tone={unsupported ? "info" : "warning"} title="IntelliFix does not propose a fix here">
          {unsupported ? "The code uses a construct that MiniC leaves out on purpose, or nests too deeply. Rewriting it automatically could change what the program means." : cards.length && cards.every((c) => c.hidesCode) ? "The only edits that parse would delete the unterminated comment together with the code hidden inside it. Only you know where the comment should end." : status === "BUDGET_EXHAUSTED" ? "The search ran out of its budget (30,000 parser runs or 4 seconds) before finding a complete fix." : "No edit of at most two tokens near the error lets the parser continue. The code may need a larger rewrite, or it may not be MiniC."}{" "}
          {doc.repair.decision.reasons[0] && <span className="faint">Engine: {doc.repair.decision.reasons[0]}</span>}
        </Banner>
      )}
      {(!cards.length || unsupported || cards.every((c) => c.hidesCode)) && (
        <div className="stack">
          <CustomLine source={source} line={firstLine} onUse={(s) => choose({ source: s, forSource: source, label: `your own version of line ${firstLine}`, kind: "answer", edits: [], parses: true })} />
          <div className="row"><button className="btn sm" onClick={onPractice}><PencilLine size={13} aria-hidden /> Use the hints and fix it in the editor</button></div>
        </div>
      )}
      {unsupported && cards.length > 0 && (
        <Disclosure summary={`Edits the parser would accept (${cards.length}) — not offered, because they change what the program means`}>
          <ul className="hint-list small">{cards.map((c) => <li key={c.index}><Rich text={c.words} /></li>)}</ul>
        </Disclosure>
      )}
      {!unsupported && !cards.every((c) => c.hidesCode) && cards.length > (status === "RECOMMENDED" ? 1 : 0) && (
        <section className="stack" aria-label="Compare the fixes">
          <h3 className="section-title">{status === "RECOMMENDED" ? `Alternatives the engine also checked (${cards.length - 1})` : cards.length === 1 ? "The only option the engine found" : `How the ${cards.length} options differ`}</h3>
          <p className="tiny muted">Each option is a real candidate: the engine applied the edit and re-ran the parser. The score is a sum of named evidence (cost, whether all errors are resolved, layout cues …). It ranks options; it is not a probability.</p>
          <div className="fix-grid">
            {cards.slice(status === "RECOMMENDED" ? 1 : 0).map((c) => (
              <div key={c.index} className={`fix-card ${p.proposal?.source === c.plan.source ? "chosen" : ""}`} data-testid="fix-card">
                <div className="row"><strong className="small">Option {c.index + 1}</strong>{c.index === 0 && <Badge tone="neutral" icon={false}>top-ranked</Badge>}</div>
                <PlanBody c={c} cards={cards} />
                <div className="row">
                  {c.placeholder ? <span className="tiny muted">Contains an invented placeholder: answer the question above with the real value instead.</span>
                    : c.hidesCode ? <span className="tiny muted">Would delete code hidden inside an unterminated comment: not offered.</span>
                    : <button className="btn sm" onClick={() => choose(fromCard(c, "plan"))}>{p.proposal?.source === c.plan.source ? <><Check size={13} aria-hidden /> Chosen</> : c.risks.length ? "Choose anyway (removes code)" : "Choose this fix"}</button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PlanBody({ c, cards }: { c: PlanCard; cards: PlanCard[] }) {
  const maxAbs = Math.max(0.5, ...c.evidence.map((e) => Math.abs(e.contribution)));
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="small"><Rich text={c.words.replace(/^./, (x) => x.toUpperCase())} /></div>
      {c.lines.slice(0, 3).map((l, i) => (
        <div key={i} className="line-change mono">
          <span className="ln">{l.line}</span>
          <span className="was">{l.before.trim() || "(new line)"}</span>
          <span className="arrow" aria-label="becomes">→</span>
          <span className="now">{l.after.trim() || "(line removed)"}</span>
        </div>
      ))}
      {c.risks.map((r) => <div key={r} className="tiny warn-text" role="note">⚠ Changes your program: it <Rich text={r} />.</div>)}
      <div className="row tiny">
        {c.valid ? <Badge tone="success">parser accepts it</Badge> : <Badge tone="warning">fixes this error; later errors remain</Badge>}
        {c.risks.length ? <Badge tone="warning" icon={false}>removes code</Badge> : <Badge tone="neutral" icon={false}>keeps your operators and names</Badge>}
        <Badge tone="neutral" icon={false}>edit cost {c.cost}</Badge>
        {c.score !== null && <Badge tone="neutral" icon={false}>score {c.score.toFixed(2)}</Badge>}
        {c.placeholder && <Badge tone="warning" icon={false}>placeholder</Badge>}
      </div>
      <div className="tiny muted">{differsFromTop(cards, c.index)}</div>
      {c.evidence.length > 0 && (
        <Disclosure summary="Why this score">
          <div className="stack" style={{ gap: 4 }}>
            {c.evidence.map((e) => (
              <div key={e.name} className="ev-mini" title={e.explanation}>
                <span className="tiny">{e.explanation}</span>
                <span className="ev-bar"><span className="zero" /><span className={`fill ${e.contribution >= 0 ? "pos" : "neg"}`} style={{ width: `${(Math.abs(e.contribution) / maxAbs) * 50}%` }} /></span>
                <span className="mono tiny">{e.contribution > 0 ? "+" : ""}{e.contribution.toFixed(2)}</span>
              </div>
            ))}
          </div>
        </Disclosure>
      )}
    </div>
  );
}

/** Feature A: explain the ambiguity, ask one targeted question, validate every answer with the real parser. */
export function ResolveAmbiguity({ doc, source, onChoose }: { doc: RepairDoc; source: string; onChoose: (p: Proposal) => void }) {
  const amb = useMemo(() => describeAmbiguity(doc), [doc]);
  const options = useMemo(() => clarifyOptions(doc), [doc]);
  const line = doc.parse.diagnostics[0]?.start.line ?? 1;
  const [choice, setChoice] = useState("");
  const [text, setText] = useState("");
  const [custom, setCustom] = useState(lineText(source, line));
  const [check, setCheck] = useState<{ source: string; ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<ApiError | null>(null);
  const [left, setLeft] = useState(false);
  useEffect(() => { setChoice(""); setText(""); setCheck(null); setLeft(false); setCustom(lineText(source, line)); }, [doc, source, line]);
  const opt = options.find((o) => o.id === choice);

  const candidate = (o: ClarifyOption | undefined): string | null => {
    if (choice === "custom") return custom !== lineText(source, line) ? replaceLine(source, line, custom) : null;
    if (!o) return null;
    if (o.source) return o.source;
    if (o.fill && text.trim()) {
      const bytes = new TextEncoder().encode(source);
      const before = new TextDecoder().decode(bytes.slice(0, o.fill.at));
      const after = new TextDecoder().decode(bytes.slice(o.fill.at + o.fill.remove));
      const pad = before.length && !/\s$/.test(before) ? " " : "";
      const tail = after.length && !/^[\s;,)\]]/.test(after) ? " " : ""; // no stray space before ; , ) ]
      return spliceBytes(source, o.fill.at, o.fill.remove, pad + text.trim() + tail);
    }
    return null;
  };
  const proposed = candidate(opt);
  const plan = opt?.source ? doc.repair.decision.plans.find((pl) => pl.source === opt.source) : undefined;

  const validate = async () => {
    if (!proposed) return;
    setBusy(true); setErr(null);
    try {
      const r = (await api.parse(proposed, false)).data.parse;
      const d = r.diagnostics[0];
      // One error at a time: the answer resolves THIS error if the parser now gets past this line.
      const later = !r.ok && d.start.line > line;
      setCheck({ source: proposed, ok: r.ok || later, message: r.ok ? "The real parser accepts the whole program with this answer." : later ? `This error is resolved: the parser now gets past line ${line} and stops later, at ${d.start.line}:${d.start.column}: ${d.message}. That is the next error; you can fix it after applying this one.` : `Still a syntax error at ${d.start.line}:${d.start.column}: ${d.message}. Try a different answer.` });
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e)));
    } finally { setBusy(false); }
  };

  if (left) return (
    <Banner tone="neutral" title="Left unresolved" actions={<button className="btn sm" onClick={() => setLeft(false)}>Reopen the question</button>}>
      Your code is unchanged. IntelliFix will not guess; edit the code whenever you know what was meant.
    </Banner>
  );
  const usable = !!check && check.source === proposed && check.ok;
  return (
    <div className="clarify" data-testid="clarify">
      <div className="small"><strong><CircleHelp size={14} aria-hidden /> What is ambiguous</strong></div>
      <p className="small"><Rich text={amb.what} /></p>
      <h3 className="clarify-q"><Rich text={amb.question} /></h3>
      <div className="stack" role="radiogroup" aria-label={amb.question.replace(/`/g, "")}>
        {options.map((o) => (
          <label key={o.id} className={`choice ${choice === o.id ? "on" : ""}`}>
            <input type="radio" name="clarify" checked={choice === o.id} onChange={() => { setChoice(o.id); setCheck(null); }} />
            <span><Rich text={o.label} /><span className="tiny muted block">{o.detail}</span></span>
          </label>
        ))}
        <label className={`choice ${choice === "custom" ? "on" : ""}`}>
          <input type="radio" name="clarify" checked={choice === "custom"} onChange={() => { setChoice("custom"); setCheck(null); }} />
          <span>Something else: write line {line} the way you meant it<span className="tiny muted block">Your own answer, checked by the parser like every other option.</span></span>
        </label>
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
      {choice === "custom" && (
        <label className="stack small">Line {line}
          <input className="input mono" value={custom} onChange={(e) => { setCustom(e.target.value); setCheck(null); }} aria-label={`Your version of line ${line}`} />
        </label>
      )}
      <div className="row">
        <button className="btn sm" onClick={validate} disabled={!proposed || busy}>Check with the parser</button>
        <button className="btn primary sm" disabled={!usable} onClick={() => onChoose({ source: check!.source, forSource: source, label: opt?.fill ? `fill in \`${text.trim()}\`` : choice === "custom" ? `your version of line ${line}` : (opt?.label ?? "").replace(/^./, (c) => c.toLowerCase()), kind: plan ? "plan" : "answer", edits: plan?.edits ?? [], parses: !check!.message.startsWith("This error is resolved") })}>
          <Check size={13} aria-hidden /> Use this answer
        </button>
        <button className="btn sm" onClick={() => setLeft(true)}><X size={13} aria-hidden /> Leave it unresolved</button>
      </div>
      {busy && <Spinner label="Parsing…" />}
      {err && <ErrorBanner error={err} />}
      {check && check.source === proposed && <Banner tone={check.ok ? "success" : "warning"} title={!check.ok ? "Not valid yet" : check.message.startsWith("This error is resolved") ? "This error is fixed; later errors remain" : "Valid MiniC"}>{check.message}</Banner>}
      <p className="tiny faint">The options are the engine's real top-ranked plans. A fill-in or your own line is your text: IntelliFix never invents a missing name or value, and it cannot know your intent.</p>
    </div>
  );
}

/** When the engine has nothing safe to offer: let the user write the line, then validate it for real. */
function CustomLine({ source, line, onUse }: { source: string; line: number; onUse: (s: string) => void }) {
  const [text, setText] = useState(lineText(source, line));
  const [check, setCheck] = useState<{ src: string; ok: boolean; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const proposed = text !== lineText(source, line) ? replaceLine(source, line, text) : null;
  return (
    <div className="fix-card">
      <strong className="small">Write line {line} yourself</strong>
      <input className="input mono" value={text} onChange={(e) => { setText(e.target.value); setCheck(null); }} aria-label={`Your version of line ${line}`} />
      <div className="row">
        <button className="btn sm" disabled={!proposed || busy} onClick={async () => {
          if (!proposed) return;
          setBusy(true);
          try { const r = (await api.parse(proposed, false)).data.parse; const d = r.diagnostics[0]; const later = !r.ok && d.start.line > line; setCheck({ src: proposed, ok: r.ok || later, msg: r.ok ? "The real parser accepts the whole program." : later ? `This line is fixed; the parser now stops later, at ${d.start.line}:${d.start.column}: ${d.message} (the next error).` : `Still a syntax error at ${d.start.line}:${d.start.column}: ${d.message}` }); }
          catch (e) { setCheck({ src: proposed, ok: false, msg: e instanceof ApiError ? e.message : String(e) }); }
          finally { setBusy(false); }
        }}>Check with the parser</button>
        <button className="btn primary sm" disabled={!check?.ok || check.src !== proposed} onClick={() => onUse(proposed!)}><Check size={13} aria-hidden /> Use this answer</button>
      </div>
      {check && check.src === proposed && <Banner tone={check.ok ? "success" : "warning"} title={check.ok ? "Valid MiniC" : "Not valid yet"}>{check.msg}</Banner>}
    </div>
  );
}
