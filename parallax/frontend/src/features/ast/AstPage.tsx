// AST Explorer: the real tree built by the Bison actions, taught through its
// structure. Three linked views: source (click code → node), outline (click
// node → source), and a node card (meaning, place in the tree, tokens it
// absorbed, the grammar rule that built it, expression diagram). A second tab
// compares two real trees (before/after a repair); partial trees of invalid
// code are labelled as partial and never completed by invention.
import { ChevronsDownUp, ChevronsUpDown, GitCompare, ListTree, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useProject } from "../../app/ProjectContext";
import { AstOutline, markKey, type Mark } from "../../components/AstOutline";
import { CodeEditor, type EditorHighlight } from "../../components/CodeEditor";
import { ExprDiagram } from "../../components/ExprDiagram";
import { Rich } from "../../components/Rich";
import { Badge, Banner, Disclosure, ErrorBanner, Panel, Spinner, Tabs } from "../../components/ui";
import { infoFor } from "../../lib/astInfo";
import { CATEGORY_LABEL, categoryOf, construction, countNodes, depthOf, errorReplacements, expressionNotes, expressionRoot, hasErrorNodes, nodeAtOffset, nodeAtPath, nodesOnPath, ownTokens, sourceOf } from "../../lib/astModel";
import { ApiError, api } from "../../services/api";
import type { AstNode, CompareResult, Edit } from "../../types/api";

type Tab = "tree" | "compare" | "raw";
export interface Shown { root: AstNode; source: string; kind: "ast" | "partial" | "fix"; label: string }

// Real parses of programs that are not in the project state (a user's answer, the "before" side of a comparison).
const parseCache = new Map<string, Promise<{ ast: AstNode | null; recovered: AstNode | null; ok: boolean }>>();
export function parseTree(source: string) {
  if (!parseCache.has(source)) {
    const pr = api.parse(source, false).then((r) => ({ ast: r.data.parse.ast, recovered: r.data.parse.recovered_ast, ok: r.data.parse.ok }));
    pr.catch(() => parseCache.delete(source));
    parseCache.set(source, pr);
  }
  return parseCache.get(source)!;
}

export function AstPage() {
  const p = useProject();
  const doc = p.parse?.envelope.data;
  const [tab, setTab] = useState<Tab>("tree");
  const [view, setView] = useState<"mine" | "fix">("mine");
  const [fixTree, setFixTree] = useState<{ root: AstNode; source: string; label: string } | null>(null);
  // Opening the explorer without a result parses the current code (a real compiler run).
  useEffect(() => {
    if (!p.parse && !p.running.parse && !p.errors.parse) void p.runParse(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // The tree of the chosen fix (or the top-ranked valid plan): real ASTs only.
  const fixSource = useMemo(() => {
    if (p.proposal && p.proposal.parses && p.parse && p.proposal.forSource === p.parse.source) return { source: p.proposal.source, label: `after your chosen fix (${p.proposal.label})` };
    const r = p.repair && p.parse && p.repair.source === p.parse.source ? p.repair.envelope.data.repair : null;
    const pl = r?.decision.plans.find((x) => x.valid);
    return pl ? { source: pl.source, label: `after the top-ranked repair (${pl.summary})`, ast: pl.ast } : null;
  }, [p.proposal, p.repair, p.parse]);
  useEffect(() => {
    setFixTree(null);
    if (!fixSource) return;
    if ("ast" in fixSource && fixSource.ast) { setFixTree({ root: fixSource.ast, source: fixSource.source, label: fixSource.label }); return; }
    let live = true;
    parseTree(fixSource.source).then((t) => live && t.ast && setFixTree({ root: t.ast, source: fixSource.source, label: fixSource.label })).catch(() => {});
    return () => { live = false; };
  }, [fixSource]);

  const shown: Shown | null = useMemo(() => {
    if (!doc || !p.parse) return null;
    if (view === "fix" && fixTree) return { root: fixTree.root, source: fixTree.source, kind: "fix", label: `AST ${fixTree.label}` };
    if (doc.parse.ast) return { root: doc.parse.ast, source: p.parse.source, kind: "ast", label: "Complete AST of your code" };
    if (doc.parse.recovered_ast) return { root: doc.parse.recovered_ast, source: p.parse.source, kind: "partial", label: "Partial tree of your code (it has syntax errors)" };
    return null;
  }, [doc, p.parse, view, fixTree]);
  useEffect(() => { if (view === "fix" && !fixSource) setView("mine"); }, [view, fixSource]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>AST Explorer</h1>
          <p>The abstract syntax tree is what the parser builds from your tokens. Click a node, or click in the code, to see what the node means, which grammar rule built it and how it connects to its neighbours.</p>
        </div>
        <button className="btn" onClick={() => p.runParse(true)} disabled={p.running.parse}>
          <ListTree size={14} aria-hidden /> {p.running.parse ? "Parsing…" : doc ? "Re-parse the current code" : "Parse the current code"}
        </button>
      </div>
      {p.errors.parse && <ErrorBanner error={p.errors.parse} onRetry={() => p.runParse(true)} />}
      {!doc && !p.errors.parse && (
        p.running.parse ? <Spinner label="Parsing…" /> : (
          <Banner tone="neutral" title="No tree yet" actions={<button className="btn primary sm" onClick={() => p.runParse(true)}>Parse the current code</button>}>
            Press <strong>Analyze</strong> in the <Link to="/">Workspace</Link>, or parse here. The tree always comes from the real compiler.
          </Banner>
        )
      )}
      {doc && p.parse && (
        <>
          {p.isStale(p.parse) && (
            <Banner tone="warning" title="The code changed since this tree was built" actions={<button className="btn sm" onClick={() => p.runParse(true)}>Re-parse</button>}>The tree below describes the earlier text.</Banner>
          )}
          <Panel flush>
            <Tabs<Tab> label="AST views" value={tab} onChange={setTab} tabs={[
              { id: "tree", label: <><ListTree size={13} aria-hidden /> Explore the tree</> },
              { id: "compare", label: <><GitCompare size={13} aria-hidden /> Before &amp; after</> },
              { id: "raw", label: "Raw JSON / text" },
            ]} />
            <div className="panel-body">
              {tab === "tree" && (
                <TreeExplorer
                  key={shown ? shown.kind + shown.source.length + shown.label : "none"}
                  shown={shown}
                  hasFix={!!fixTree}
                  view={view}
                  setView={setView}
                  diagnostics={doc.parse.diagnostics.length}
                />
              )}
              {tab === "compare" && <ComparePane />}
              {tab === "raw" && (shown ? (
                <div className="stack">
                  <p className="tiny muted">{shown.label}. The JSON is exactly what <code>parallaxc</code> printed.</p>
                  <pre className="code-block" style={{ maxHeight: 560 }}>{JSON.stringify(shown.root, null, 2)}</pre>
                  {shown.kind === "ast" && doc.parse.ast_text && <Disclosure summary="Indented text form (parallaxc --tree)"><pre className="code-block">{doc.parse.ast_text}</pre></Disclosure>}
                </div>
              ) : <p className="small muted">The parser produced no tree for this input.</p>)}
            </div>
          </Panel>
        </>
      )}
    </>
  );
}

// ------------------------------------------------------------------ tree tab
function TreeExplorer({ shown, hasFix, view, setView, diagnostics }: { shown: Shown | null; hasFix: boolean; view: "mine" | "fix"; setView: (v: "mine" | "fix") => void; diagnostics: number }) {
  const [sel, setSel] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [openAll, setOpenAll] = useState({ open: true, n: 0 });
  const node = shown && sel ? nodeAtPath(shown.root, sel) : null;
  const highlights: EditorHighlight[] = useMemo(() => (node ? [{ from: node.span.start.offset, to: node.span.end.offset, tone: "select" }] : []), [node]);

  if (!shown) return <p className="small muted">The parser produced no tree for this input (for example, the file ends inside a comment or the nesting limit was reached). Nothing is drawn rather than inventing nodes.</p>;
  const partial = shown.kind === "partial";
  return (
    <div className="stack">
      <div className="row ast-toolbar">
        <div className="seg" role="group" aria-label="Which tree">
          <button className={`seg-btn ${view === "mine" ? "on" : ""}`} onClick={() => setView("mine")} aria-pressed={view === "mine"}>Your code</button>
          <button className={`seg-btn ${view === "fix" ? "on" : ""}`} onClick={() => setView("fix")} disabled={!hasFix} aria-pressed={view === "fix"} title={hasFix ? undefined : "Analyze code with an error to get a repaired program"}>After the fix</button>
        </div>
        <Badge tone={shown.kind === "ast" ? "success" : shown.kind === "fix" ? "info" : "warning"} icon={false}>{shown.label}</Badge>
        <span className="tiny muted">{countNodes(shown.root)} nodes · depth {depthOf(shown.root)}</span>
        <div className="spacer" />
        <label className="search-box">
          <Search size={13} aria-hidden />
          <span className="sr-only">Search the tree</span>
          <input className="input sm" placeholder="Find: While, total, +, 10…" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button className="btn sm" onClick={() => setOpenAll((o) => ({ open: true, n: o.n + 1 }))}><ChevronsUpDown size={13} aria-hidden /> Expand all</button>
        <button className="btn sm" onClick={() => setOpenAll((o) => ({ open: false, n: o.n + 1 }))}><ChevronsDownUp size={13} aria-hidden /> Collapse all</button>
      </div>
      {partial && (
        <Banner tone="warning" title="Partial tree: your code has syntax errors">
          The parser reported {diagnostics} error(s). It skipped the text it could not understand and left <strong>Error</strong> nodes in its place; the rest is what it could still build. This is not a complete AST.
          {hasFix && <> Switch to <strong>After the fix</strong> to see the complete tree of the repaired program.</>}
        </Banner>
      )}
      {shown.kind === "fix" && <Banner tone="info" title="This is the tree of the repaired program, not of your current code">Apply the fix in the Workspace to make it yours. Nothing here is invented: the repaired program was parsed by the compiler.</Banner>}
      <Legend />
      <div className="ast-grid">
        <div className="stack">
          <div className="ast-pane-title">Source <span className="tiny faint">click code to find its node</span></div>
          <CodeEditor value={shown.source} readOnly highlights={highlights} minHeight={200} maxHeight={460} ariaLabel="Source (read-only)" onCursor={(off) => { const path = nodeAtOffset(shown.root, off); if (path) setSel(path); }} />
          {sel && <Breadcrumb root={shown.root} path={sel} onSelect={setSel} />}
        </div>
        <div className="stack">
          <div className="ast-pane-title">Tree <span className="tiny faint">indentation = “contains”; grey text = role in the parent</span></div>
          <div className="outline-wrap">
            <AstOutline root={shown.root} selected={sel} onSelect={setSel} query={query} openAll={openAll} />
          </div>
        </div>
        <NodeCard shown={shown} path={sel} onSelect={setSel} />
      </div>
    </div>
  );
}

function Legend() {
  return (
    <div className="legend ast-legend" aria-label="Node categories">
      {(Object.keys(CATEGORY_LABEL) as (keyof typeof CATEGORY_LABEL)[]).map((c) => <span key={c} className={`cat-${c}`}><span className="odot" aria-hidden />{CATEGORY_LABEL[c]}</span>)}
    </div>
  );
}

function Breadcrumb({ root, path, onSelect }: { root: AstNode; path: string; onSelect: (p: string) => void }) {
  const chain = nodesOnPath(root, path);
  return (
    <nav className="crumbs small" aria-label="Path from the root">
      {chain.map((c, i) => (
        <span key={c.path}>
          {i > 0 && <span className="faint"> › </span>}
          <button className={`linklike ${i === chain.length - 1 ? "cur" : ""}`} onClick={() => onSelect(c.path)}>{c.node.kind}{c.node.name ? ` ${c.node.name}` : c.node.op ? ` ${c.node.op}` : ""}</button>
        </span>
      ))}
    </nav>
  );
}

function NodeCard({ shown, path, onSelect }: { shown: Shown; path: string | null; onSelect: (p: string) => void }) {
  const n = path ? nodeAtPath(shown.root, path) : null;
  if (!n || !path) {
    // sensible starting points from the real tree
    const starts: { label: string; path: string }[] = [];
    const fnIdx = shown.root.children.findIndex((c) => c.kind === "Function");
    if (fnIdx >= 0) starts.push({ label: `the function ${shown.root.children[fnIdx].name}`, path: `0/${fnIdx}` });
    const findFirst = (pred: (x: AstNode) => boolean) => {
      const rec = (x: AstNode, p: string): string | null => (pred(x) ? p : x.children.reduce<string | null>((acc, c, i) => acc ?? rec(c, `${p}/${i}`), null));
      return rec(shown.root, "0");
    };
    const stmt = findFirst((x) => categoryOf(x) === "statement");
    if (stmt) starts.push({ label: "the first statement", path: stmt });
    const ex = findFirst((x) => x.kind === "Binary");
    if (ex) starts.push({ label: "an operator expression", path: ex });
    const err = findFirst((x) => x.kind === "Error");
    if (err) starts.push({ label: "the Error node", path: err });
    return (
      <div className="node-card empty-card">
        <h3>How to read the tree</h3>
        <ul className="hint-list small">
          <li>Each row is a node. A node <strong>contains</strong> the rows indented below it.</li>
          <li>The grey text before a node is its <strong>role</strong> in its parent, e.g. <em>the condition</em> or <em>left operand</em>.</li>
          <li>Punctuation such as <code>;</code> <code>(</code> <code>)</code> does not become nodes: the shape of the tree already records it.</li>
        </ul>
        {starts.length > 0 && <div className="row small">Start with: {starts.map((s) => <button key={s.path} className="btn sm" onClick={() => onSelect(s.path)}>{s.label}</button>)}</div>}
      </div>
    );
  }
  const info = infoFor(n);
  const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : null;
  const parent = parentPath ? nodeAtPath(shown.root, parentPath) : null;
  const idx = Number(path.split("/").pop());
  const role = parent ? infoFor(parent).childRole(parent, idx) : "";
  const k = construction(n, parent, idx);
  const text = sourceOf(shown.source, n).trim();
  const own = ownTokens(n, shown.source);
  const expr = expressionRoot(shown.root, path);
  const notes = expressionNotes(n, shown.source);
  const prev = parent && idx > 0 ? `${parentPath}/${idx - 1}` : null;
  const next = parent && idx < parent.children.length - 1 ? `${parentPath}/${idx + 1}` : null;
  const cat = categoryOf(n);
  return (
    <div className={`node-card cat-${cat}`} data-testid="node-card">
      <div className="node-card-head">
        <span className="odot" aria-hidden />
        <h3>{n.kind}{n.name ? ` ${n.name}` : n.op ? ` ${n.op}` : n.value ? ` ${n.value}` : ""}</h3>
        <span className="tiny muted">{CATEGORY_LABEL[cat]}</span>
      </div>
      <p className="small"><Rich text={info.plain(n)} /></p>

      <section>
        <h4>Place in the tree</h4>
        <div className="small stack" style={{ gap: 4 }}>
          {parent ? <div>Inside <button className="linklike" onClick={() => onSelect(parentPath!)}>{parent.kind}{parent.name ? ` ${parent.name}` : ""}</button>{role && <> as <strong>{role}</strong></>}.</div> : <div>The root: every other node is inside it.</div>}
          {n.children.length > 0 ? (
            <div>Contains:
              <ul className="child-list">
                {n.children.map((c, i) => (
                  <li key={i}><span className="faint">{info.childRole(n, i) || `child ${i + 1}`}:</span> <button className="linklike" onClick={() => onSelect(`${path}/${i}`)}>{c.kind}{c.name ? ` ${c.name}` : c.op ? ` ${c.op}` : c.value ? ` ${c.value}` : ""}</button></li>
                ))}
              </ul>
            </div>
          ) : <div className="muted">A leaf: no children.</div>}
          {(prev || next) && <div className="row">{prev && <button className="btn sm" onClick={() => onSelect(prev)}>← previous sibling</button>}{next && <button className="btn sm" onClick={() => onSelect(next)}>next sibling →</button>}</div>}
        </div>
      </section>

      <section>
        <h4>Source</h4>
        <div className="tiny muted">line {n.span.start.line}, column {n.span.start.column} to line {n.span.end.line}, column {n.span.end.column}</div>
        {text ? <pre className="code-block node-src">{text.length > 300 ? text.slice(0, 300) + " …" : text}</pre> : <span className="tiny faint">empty span (an omitted clause)</span>}
        {own.length > 0 && (
          <div className="small" style={{ marginTop: 6 }}>
            <span className="muted">Tokens this node takes for itself (the rest belong to its children):</span>
            <ul className="tok-list">{own.map((t, i) => <li key={i}><code>{t.text}</code> <span className="tiny muted">{t.meaning}</span></li>)}</ul>
          </div>
        )}
      </section>

      {expr && (
        <section>
          <h4>Expression structure</h4>
          <ExprDiagram root={expr.node} rootPath={expr.path} selected={path} onSelect={onSelect} />
          {notes.length > 0 && <ul className="hint-list small">{notes.map((t, i) => <li key={i}><Rich text={t} /></li>)}</ul>}
        </section>
      )}

      <section>
        <h4>Why the parser built it</h4>
        <code className="rule">{k.rule}</code>
        <p className="small muted" style={{ marginTop: 4 }}><Rich text={k.why} /></p>
        {shown.kind === "partial" && n.kind !== "Error" && <p className="tiny muted">Part of a partial tree: built before or after the parser skipped text, so it may not match what you meant.</p>}
      </section>

      <Disclosure summary="Technical details">
        <dl className="kv small">
          <dt>Kind</dt><dd className="mono">{n.kind}</dd>
          {(["type", "name", "op", "value", "array"] as const).map((a) => (n[a] ? <span key={a} style={{ display: "contents" }}><dt>{a}</dt><dd className="mono">{n[a]}</dd></span> : null))}
          <dt>Byte offsets</dt><dd className="mono">{n.span.start.offset}–{n.span.end.offset}</dd>
          <dt>Token indices</dt><dd className="mono">{n.span.tokens}</dd>
          <dt>Subtree</dt><dd>{countNodes(n)} nodes, depth {depthOf(n)}</dd>
          <dt>Path</dt><dd className="mono tiny">{path}</dd>
        </dl>
      </Disclosure>
    </div>
  );
}

// ------------------------------------------------------------------ before & after
interface Choice { id: string; label: string; source: string; edits: Edit[] }

export function useCompareChoices(): { choices: Choice[]; defaults: [string, string] } {
  const p = useProject();
  return useMemo(() => {
    const out: Choice[] = [{ id: "current", label: "Your current code", source: p.source, edits: [] }];
    if (p.history.length) out.push({ id: "before-repair", label: "Your code before the last applied fix", source: p.history[p.history.length - 1].source, edits: [] });
    if (p.proposal && p.proposal.forSource === p.source) out.push({ id: "proposal", label: `Your chosen fix: ${p.proposal.label}`, source: p.proposal.source, edits: p.proposal.edits });
    const r = p.repair && p.repair.source === p.source ? p.repair.envelope.data.repair : null;
    r?.decision.plans.forEach((pl, i) => out.push({ id: `plan${i}`, label: `Option ${i + 1}: ${pl.summary}`, source: pl.source, edits: pl.edits }));
    const currentValid = !!(p.parse && p.parse.source === p.source && p.parse.envelope.data.parse.ok);
    const valid = (r?.decision.plans ?? []).map((pl, i) => ({ pl, i })).filter((x) => x.pl.valid);
    let d: [string, string];
    if (out.some((c) => c.id === "proposal")) d = ["current", "proposal"];
    else if (p.history.length && currentValid) d = ["before-repair", "current"];
    else if (!currentValid && valid.length >= 2) d = [`plan${valid[0].i}`, `plan${valid[1].i}`];
    else d = ["current", out.find((c) => c.id === "plan0")?.id ?? out[0].id];
    return { choices: out, defaults: d };
  }, [p.source, p.history, p.proposal, p.repair, p.parse]);
}

export function ComparePane() {
  const { choices, defaults } = useCompareChoices();
  const [a, setA] = useState(defaults[0]);
  const [b, setB] = useState(defaults[1]);
  const A = choices.find((c) => c.id === a), B = choices.find((c) => c.id === b);
  return (
    <div className="stack">
      <p className="small muted">Pick two programs. Both are parsed again by the compiler and their real trees are aligned node by node; nodes that were added, removed or changed are marked.</p>
      <div className="grid grid-2">
        <label className="stack small">Before
          <select className="select" value={a} onChange={(e) => setA(e.target.value)}>{choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </label>
        <label className="stack small">After
          <select className="select" value={b} onChange={(e) => setB(e.target.value)}>{choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
        </label>
      </div>
      {choices.length < 2 && <p className="tiny faint">Analyze code with an error (or apply a fix) to get a second program to compare.</p>}
      {A && B && <TreeComparison before={A.source} after={B.source} edits={[...(B.edits.length ? [{ side: B.label.split(":")[0], edits: B.edits }] : []), ...(A.edits.length ? [{ side: A.label.split(":")[0], edits: A.edits }] : [])]} />}
    </div>
  );
}

/** Real structural comparison of two programs, with reasons tied to the edits that were made. */
export function TreeComparison({ before, after, edits = [], compact }: { before: string; after: string; edits?: { side: string; edits: Edit[] }[]; compact?: boolean }) {
  const [res, setRes] = useState<CompareResult | null>(null);
  const [partial, setPartial] = useState<AstNode | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setRes(null); setPartial(null); setErr(null);
    if (before === after) return;
    setBusy(true);
    api.compare(before, after)
      .then(async (r) => {
        if (!live) return;
        setRes(r.data);
        if (!r.data.before.ok) { const t = await parseTree(before); if (live) setPartial(t.recovered); }
      })
      .catch((e) => live && setErr(e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e))))
      .finally(() => live && setBusy(false));
    return () => { live = false; };
  }, [before, after]);

  if (before === after) return <Banner tone="neutral" title="The same program twice">Choose two different programs to compare.</Banner>;
  if (busy) return <Spinner label="Parsing both programs…" />;
  if (err) return <ErrorBanner error={err} />;
  if (!res) return null;

  const why = (span: { start: { line: number }; end: { line: number } } | null | undefined) => {
    if (!span) return [];
    return edits.flatMap((g) => g.edits.filter((e) => e.at.line >= span.start.line && e.at.line <= span.end.line).map((e) => `${g.side}: ${e.op} ${e.op === "delete" ? `\`${e.removed_text}\`` : `\`${e.text}\``} at ${e.at.line}:${e.at.column}`));
  };

  if (!res.comparable) {
    const repl = partial && res.after.ast ? errorReplacements(partial, res.after.ast) : [];
    const mb = new Map<string, Mark>(), ma = new Map<string, Mark>();
    for (const r of repl) { mb.set(markKey(r.error.kind, r.error.span), "removed"); r.replacedBy.forEach((x) => ma.set(markKey(x.node.kind, x.node.span), "added")); }
    return (
      <div className="stack">
        <Banner tone="info" title={res.before.ok ? "The second program has syntax errors" : "Partial tree → complete tree"}>
          {res.before.ok ? "A program with syntax errors has no complete AST, so no node-by-node comparison is claimed." : "The code before the fix has syntax errors, so it only has a partial tree. Below, each Error node of the partial tree is matched to the statements that occupy the same lines in the repaired program (a line-based match)."}
        </Banner>
        {repl.map((r, i) => (
          <div key={i} className="change-row small">
            <Badge tone="danger" icon={false}>Error node</Badge> line {r.error.span.start.line}{r.error.span.end.line !== r.error.span.start.line ? `–${r.error.span.end.line}` : ""}: the parser skipped <code>{sourceOf(before, r.error).trim().slice(0, 80)}</code>
            <span className="faint"> → </span>
            {r.replacedBy.length ? r.replacedBy.map((x, j) => <span key={j}><Badge tone="success" icon={false}>{x.node.kind}{x.node.name ? ` ${x.node.name}` : x.node.type ? ` ${x.node.type}` : ""}</Badge> </span>) : <span className="muted">no statement on those lines</span>}
            {why(r.error.span).length > 0 && <div className="tiny muted">edit on these lines: {why(r.error.span).join("; ")}</div>}
          </div>
        ))}
        <div className="grid grid-2">
          <div className="stack"><strong className="small">Before: partial tree</strong>{partial ? <AstOutline root={partial} compact={compact} marks={mb} expandDepth={4} label="Partial tree before" /> : <p className="tiny muted">The parser produced no partial tree.</p>}</div>
          <div className="stack"><strong className="small">After: complete AST</strong>{res.after.ast ? <AstOutline root={res.after.ast} compact={compact} marks={ma} expandDepth={4} label="Complete tree after" /> : <p className="tiny muted">The second program has syntax errors: {res.after.diagnostics[0]}</p>}</div>
        </div>
      </div>
    );
  }
  if (res.equivalent) return <Banner tone="success" title="Structurally identical">Same canonical AST (hash {res.after.ast_hash}): the programs differ only in spacing, comments or redundant parentheses.</Banner>;
  const mb = new Map<string, Mark>(), ma = new Map<string, Mark>();
  for (const c of res.changes) {
    const kind = c.path.split("/").pop()!.replace(/\[\d+\]$/, "");
    if (c.before_span && c.change !== "added") mb.set(markKey(kind, c.before_span), c.change as Mark);
    if (c.after_span && c.change !== "removed") ma.set(markKey(kind, c.after_span), c.change as Mark);
  }
  return (
    <div className="stack">
      <Banner tone="info" title={`${res.changes.length} structural change(s)`}>
        {res.changes.filter((c) => c.change === "added").length} added · {res.changes.filter((c) => c.change === "removed").length} removed · {res.changes.filter((c) => c.change === "changed").length} changed. Everything else is the same tree.
      </Banner>
      {res.changes.slice(0, 12).map((c, i) => {
        const reasons = why(c.after_span ?? c.before_span);
        return (
          <div key={i} className="change-row small">
            <Badge tone={c.change === "added" ? "success" : c.change === "removed" ? "danger" : "warning"} icon={false}>{c.change}</Badge>{" "}
            {c.change === "changed" ? <><code>{c.before}</code> → <code>{c.after}</code></> : <code>{c.after ?? c.before}</code>}
            <span className="tiny muted"> (line {(c.after_span ?? c.before_span)?.start.line ?? "?"}{c.detail ? `; ${c.detail}` : ""})</span>
            {reasons.length > 0 && <div className="tiny muted">edit on the same line: {reasons.join("; ")}</div>}
          </div>
        );
      })}
      {res.changes.length > 12 && <p className="tiny faint">and {res.changes.length - 12} more.</p>}
      <div className="grid grid-2">
        <div className="stack"><strong className="small">Before</strong>{res.before.ast && <AstOutline root={res.before.ast} compact={compact} marks={mb} expandDepth={3} label="Tree before" />}</div>
        <div className="stack"><strong className="small">After</strong>{res.after.ast && <AstOutline root={res.after.ast} compact={compact} marks={ma} expandDepth={3} label="Tree after" />}</div>
      </div>
    </div>
  );
}

export { hasErrorNodes };
