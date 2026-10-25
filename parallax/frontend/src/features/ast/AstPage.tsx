import { GitCompare, ListTree } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useProject } from "../../app/ProjectContext";
import { AstTree, countNodes, findByPath } from "../../components/AstTree";
import { CodeEditor, type EditorHighlight } from "../../components/CodeEditor";
import { RunGate } from "../../components/RunGate";
import { Badge, Banner, Disclosure, EmptyState, ErrorBanner, Panel, Spinner, Tabs } from "../../components/ui";
import { useDemoFocus } from "../demo/DemoContext";
import { formatPos } from "../../lib/positions";
import { ApiError, api } from "../../services/api";
import type { AstNode, CompareResult } from "../../types/api";

type Tab = "tree" | "json" | "text" | "compare";

export function AstPage() {
  const p = useProject();
  const doc = p.parse?.envelope.data;
  const focus = useDemoFocus("ast");
  const [tab, setTab] = useState<Tab>("tree");
  const [sel, setSel] = useState<{ node: AstNode; path: string } | null>(null);
  useEffect(() => {
    if (focus) setTab(focus as Tab);
  }, [focus]);
  useEffect(() => setSel(null), [doc]);

  const highlights: EditorHighlight[] = useMemo(() => (sel ? [{ from: sel.node.span.start.offset, to: sel.node.span.end.offset, tone: "select" }] : []), [sel]);

  return (
    <>
      <div className="page-head">
        <div>
          <h1>AST explorer</h1>
          <p>The abstract syntax tree keeps program structure and drops syntax that carries no meaning (parentheses, semicolons, braces). IntelliFix groups repairs by this structure, so two repairs that differ only in such tokens count as one hypothesis.</p>
        </div>
        <button className="btn primary" onClick={() => p.runParse(true)} disabled={p.running.parse}>
          <ListTree size={14} aria-hidden /> {p.running.parse ? "Parsing…" : "Build AST"}
        </button>
      </div>
      <RunGate kind="parse" has={!!doc} what="parser">
        {doc && (
          <div className="split">
            <div className="stack">
              <Panel title="Source">
                <CodeEditor value={p.parse!.source} readOnly highlights={highlights} minHeight={240} maxHeight={460} ariaLabel="Source (read-only)" />
              </Panel>
              <Panel title={sel ? `Selected: ${sel.node.kind}` : "Node details"}>
                {sel ? (
                  <dl className="kv">
                    <dt>Kind</dt><dd className="mono">{sel.node.kind}</dd>
                    {(["type", "name", "op", "value", "array"] as const).map((k) => sel.node[k] ? (<span key={k} style={{ display: "contents" }}><dt>{k}</dt><dd className="mono">{sel.node[k]}</dd></span>) : null)}
                    <dt>Source span</dt><dd className="mono">{formatPos(sel.node.span.start)} → {formatPos(sel.node.span.end)}</dd>
                    <dt>Tokens</dt><dd className="mono">{sel.node.span.tokens}</dd>
                    <dt>Children</dt><dd>{sel.node.children.length} (subtree {countNodes(sel.node)} nodes)</dd>
                    <dt>Path</dt><dd className="mono tiny">{sel.path}</dd>
                  </dl>
                ) : (
                  <p className="muted small">Select a node in the tree to highlight the source it covers.</p>
                )}
              </Panel>
              <Panel title="Parse tree vs. AST">
                <p className="small">
                  A <strong>parse tree</strong> records every grammar rule used, including chains like <code>expr → or_expr → … → primary</code> and every token. The <strong>AST</strong> built by the Bison actions keeps only meaningful structure:
                  <code> (a + b) * c </code> becomes <code>Binary * (Binary + (a, b), c)</code>. The parse progression of the parser view shows the parse-tree steps; this page shows the AST.
                </p>
              </Panel>
            </div>
            <Panel flush>
              <Tabs<Tab>
                label="AST views"
                value={tab}
                onChange={setTab}
                tabs={[
                  { id: "tree", label: "Tree" },
                  { id: "json", label: "JSON" },
                  { id: "text", label: "Text" },
                  { id: "compare", label: <><GitCompare size={13} aria-hidden /> Compare</> },
                ]}
              />
              <div className="panel-body">
                {tab !== "compare" && !doc.parse.ast && (
                  <EmptyState title="No valid AST for this source">
                    The parser reported {doc.parse.diagnostics.length} syntax error(s), so no complete AST exists. Run a repair and use <em>Compare</em> to inspect the AST of a repaired program.
                  </EmptyState>
                )}
                {tab === "tree" && doc.parse.ast && (
                  <div className="stack">
                    <div className="row small muted">
                      <Badge tone="neutral" icon={false}>{doc.parse.ast_nodes} nodes</Badge>
                      <Badge tone="neutral" icon={false}>depth {doc.parse.ast_depth}</Badge>
                      <span className="mono tiny" title="FNV-1a hash of the canonical form">hash {doc.parse.ast_hash}</span>
                    </div>
                    <div className="scroll-y" style={{ maxHeight: 620 }}>
                      <AstTree root={doc.parse.ast} selected={sel?.path} onSelect={(node, path) => setSel({ node, path })} />
                    </div>
                    {!!doc.parse.name_warnings?.length && (
                      <Disclosure summary={`Static name checks: ${doc.parse.name_warnings.length} warning(s)`}>
                        <ul className="hint-list">
                          {doc.parse.name_warnings.map((w, i) => (
                            <li key={i}><span className="mono">{formatPos(w.start)}</span> {w.message}</li>
                          ))}
                        </ul>
                        <p className="tiny faint">Name resolution only (scopes, arity); MiniC has no type checker.</p>
                      </Disclosure>
                    )}
                  </div>
                )}
                {tab === "json" && doc.parse.ast && <pre className="code-block" style={{ maxHeight: 640 }}>{JSON.stringify(doc.parse.ast, null, 2)}</pre>}
                {tab === "text" && doc.parse.ast && <pre className="code-block" style={{ maxHeight: 640 }}>{doc.parse.ast_text}</pre>}
                {tab === "compare" && <ComparePane />}
              </div>
            </Panel>
          </div>
        )}
      </RunGate>
    </>
  );
}

function ComparePane() {
  const p = useProject();
  const choices = useMemo(() => {
    const out: { id: string; label: string; source: string }[] = [{ id: "current", label: "Current editor source", source: p.source }];
    if (p.baseline !== p.source) out.push({ id: "baseline", label: "Source as loaded", source: p.baseline });
    if (p.history.length) out.push({ id: "before-repair", label: "Before last accepted repair", source: p.history[p.history.length - 1].source });
    const r = p.repair?.envelope.data.repair;
    r?.decision.plans.forEach((pl, i) => out.push({ id: `plan${i}`, label: `Plan #${i + 1}: ${pl.summary}`, source: pl.source }));
    r?.candidates.slice(0, 10).forEach((c) => {
      if (c.valid) out.push({ id: `cand${c.id}`, label: `Candidate #${c.rank}: ${c.summary}`, source: c.source });
    });
    return out;
  }, [p.source, p.baseline, p.history, p.repair]);
  const [a, setA] = useState("current");
  const [b, setB] = useState(choices[1]?.id ?? "current");
  const [res, setRes] = useState<CompareResult | null>(null);
  const [err, setErr] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const pick = (id: string) => choices.find((c) => c.id === id);

  const run = async () => {
    const A = pick(a), B = pick(b);
    if (!A || !B) return;
    setBusy(true);
    setErr(null);
    try {
      setRes((await api.compare(A.source, B.source)).data);
    } catch (e) {
      setErr(e instanceof ApiError ? e : new ApiError("BACKEND_FAILURE", String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <p className="small muted">Compare the canonical ASTs of two programs. Both are parsed again by the compiler; the structural diff aligns children with an LCS over canonical subtrees.</p>
      <div className="grid grid-2">
        <label className="stack small">
          Before
          <select className="select" value={a} onChange={(e) => setA(e.target.value)}>
            {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
        <label className="stack small">
          After
          <select className="select" value={b} onChange={(e) => setB(e.target.value)}>
            {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      </div>
      <div><button className="btn primary sm" onClick={run} disabled={busy}><GitCompare size={13} aria-hidden /> Compare ASTs</button></div>
      {choices.length < 2 && <p className="tiny faint">Run a repair or accept one to get more programs to compare.</p>}
      {busy && <Spinner />}
      {err && <ErrorBanner error={err} onRetry={run} />}
      {res && (
        <div className="stack">
          {!res.comparable ? (
            <Banner tone="warning" title="Cannot compare: at least one side has no valid AST">
              {[...res.before.diagnostics, ...res.after.diagnostics].slice(0, 3).join(" · ")}
            </Banner>
          ) : res.equivalent ? (
            <Banner tone="success" title="Structurally identical">Same canonical AST (hash {res.after.ast_hash}). {res.rule}</Banner>
          ) : (
            <Banner tone="info" title={`${res.changes.length} structural change(s)`}>{res.rule}</Banner>
          )}
          {res.changes.length > 0 && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Change</th><th>Path</th><th>Before</th><th>After</th></tr></thead>
                <tbody>
                  {res.changes.map((c, i) => (
                    <tr key={i}>
                      <td><Badge tone={c.change === "added" ? "success" : c.change === "removed" ? "danger" : "warning"} icon={false}>{c.change}</Badge></td>
                      <td className="mono tiny">{c.path}</td>
                      <td className="mono small">{c.before ?? "—"}</td>
                      <td className="mono small">{c.after ?? "—"}{c.detail && <div className="tiny muted">{c.detail}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {res.comparable && (
            <div className="grid grid-2">
              <Disclosure summary="Before AST">{res.before.ast && <AstTree root={res.before.ast} expandDepth={3} />}</Disclosure>
              <Disclosure summary="After AST">{res.after.ast && <AstTree root={res.after.ast} expandDepth={3} />}</Disclosure>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export { findByPath };
