// One row per compiler run (lexer / parser / repair) so that every button on
// the workbench gives visible feedback: not run, running, result, error, or
// "stale" (computed for an earlier version of the editor text).
import { Link } from "react-router-dom";
import { useProject, type RunKind } from "../../app/ProjectContext";
import { Badge, Spinner } from "../../components/ui";
import { STATUS } from "../../lib/status";

const LABEL: Record<RunKind, string> = { lex: "Lexer", parse: "Parser", repair: "Repair engine" };
const ROUTE: Record<RunKind, string> = { lex: "/lexer", parse: "/parser", repair: "/repair" };

export function RunSummary() {
  const p = useProject();
  const rows: { kind: RunKind; text: string | null; tone: "success" | "warning" | "danger" | "info" | "neutral" }[] = [];

  const lex = p.lex?.envelope.data;
  rows.push({
    kind: "lex",
    text: lex ? `${lex.tokens.length} tokens, ${lex.lexical_errors.length} lexical error(s), ${lex.comments.length} comment(s)` : null,
    tone: lex ? (lex.lexical_errors.length ? "warning" : "success") : "neutral",
  });
  const parse = p.parse?.envelope.data;
  const d0 = parse?.parse.diagnostics[0];
  rows.push({
    kind: "parse",
    text: parse
      ? parse.parse.ok
        ? `accepted: valid program, AST with ${parse.parse.ast_nodes} nodes`
        : `rejected: ${d0?.message} at ${d0?.start.line}:${d0?.start.column} (${parse.parse.diagnostics.length} diagnostic(s) with recovery)`
      : null,
    tone: parse ? (parse.parse.ok ? "success" : "danger") : "neutral",
  });
  const rep = p.repair?.envelope.data.repair;
  rows.push({
    kind: "repair",
    text: rep ? `${STATUS[rep.decision.status].label}: ${rep.counts.generated} candidates, ${rep.counts.accepted} parser-validated, ${rep.counts.classes} AST classes` : null,
    tone: rep ? STATUS[rep.decision.status].tone : "neutral",
  });

  return (
    <div className="panel" aria-label="Run results">
      <div className="panel-head"><h3>Run results</h3><span className="tiny muted">each row comes from the compiler for the text it was run on</span></div>
      <div className="panel-body stack" style={{ gap: 8 }}>
        {rows.map((r) => {
          const result = r.kind === "lex" ? p.lex : r.kind === "parse" ? p.parse : p.repair;
          const err = p.errors[r.kind];
          const stale = p.isStale(result);
          return (
            <div key={r.kind} className="row small" style={{ alignItems: "flex-start", flexWrap: "nowrap" }} data-testid={`run-${r.kind}`}>
              <strong style={{ width: 104, flex: "none" }}>{LABEL[r.kind]}</strong>
              <div style={{ flex: 1, minWidth: 0 }}>
                {p.running[r.kind] ? (
                  <Spinner label="running…" />
                ) : err ? (
                  <>
                    <Badge tone="danger">{err.code}</Badge> <span style={{ overflowWrap: "anywhere" }}>{err.message}</span>
                  </>
                ) : r.text ? (
                  <>
                    <Badge tone={r.tone} icon={false}>{stale ? "earlier text" : "current text"}</Badge> <span>{r.text}</span>
                    {stale && <div className="tiny muted">The editor changed after this run; run it again for the current text.</div>}
                  </>
                ) : (
                  <span className="muted">not run yet</span>
                )}
              </div>
              {r.text && !p.running[r.kind] && <Link to={ROUTE[r.kind]} className="tiny nowrap">details →</Link>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
