// User-controlled guided demonstration. Every step drives real functionality
// (loading a bundled sample and running the actual compiler); nothing is
// pre-recorded. Users move with Next/Back and can leave at any time.
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useProject } from "../../app/ProjectContext";
import { Badge, StatusBadge } from "../../components/ui";
import { useDemo } from "./DemoContext";

interface Step {
  title: string;
  body: string;
  route: string;
  example?: string;
  focus?: string;
  look: string; // what to look at on screen
  acceptAction?: boolean;
}

const STEPS: Step[] = [
  { title: "Start with a valid program", route: "/workbench", example: "01_valid_basic", body: "A small MiniC program with a function, a loop and arithmetic. The full pipeline runs live on the compiler.", look: "The status should read “No repair needed”." },
  { title: "Its token stream", route: "/lexer", example: "01_valid_basic", body: "Flex splits the bytes into tokens. Each token has a kind, a category and an exact source span.", look: "Click any row to highlight that token in the source and see the Flex rule that produced it." },
  { title: "Its abstract syntax tree", route: "/ast", example: "01_valid_basic", focus: "ast:tree", body: "The Bison actions build an AST: structure without punctuation.", look: "Select a node to highlight the source it covers." },
  { title: "Introduce a syntax error", route: "/workbench", example: "02_missing_semicolon", body: "The same kind of program, but a declaration lost its ‘;’.", look: "The editor marks where the parser detected the problem — on the next line." },
  { title: "Exact error location and expectations", route: "/parser", example: "02_missing_semicolon", body: "The parser stops at the first token that cannot continue any rule. Thanks to LAC, the list of expected tokens is exact.", look: "Compare the detection point with the expected tokens and the LR state items." },
  { title: "The parser's own diagnostic", route: "/parser", example: "02_missing_semicolon", body: "Plain Bison only says “unexpected identifier”. Panic-mode recovery can continue and report more errors, but proposes no fix.", look: "Open the Recovery tab to see Baseline B's behaviour." },
  { title: "Generate repair candidates", route: "/repair", example: "02_missing_semicolon", focus: "repair:candidates", body: "IntelliFix proposes bounded insert/delete/replace edits around the error, using the parser's expected tokens and layout cues.", look: "Each row is one candidate that the real parser accepted." },
  { title: "Compare candidates and their edits", route: "/repair", example: "02_missing_semicolon", focus: "repair:compare", body: "Two candidates side by side: their edit operations, evidence and source changes. The original source is never modified.", look: "Rank 2 turns ‘int’ into ‘,’ — also a valid program. Why does inserting ‘;’ win? Compare edit_cost, deleted_content and line_end_semicolon." },
  { title: "Validation by the real parser", route: "/repair", example: "02_missing_semicolon", focus: "repair:rejected", body: "Most generated edits are rejected — e.g. fixes that only move the error a token or two further.", look: "Every rejection has a recorded reason." },
  { title: "Group candidates by AST", route: "/repair", example: "12_extra_token", focus: "repair:classes", body: "Deleting the extra ‘)’ and inserting a matching ‘(’ are different edits but the same program. They form one class.", look: "Class 0 has two members; the runner-up class is a genuinely different AST." },
  { title: "The ranking evidence", route: "/repair", example: "12_extra_token", focus: "repair:candidates", body: "The score is a sum of named, signed contributions. Nothing is hidden in a black box.", look: "Open “Why rank 1 outranks …” in the detail panel." },
  { title: "Follow-on diagnostic stability", route: "/hypotheses", example: "06_multiple_errors", body: "Two errors. Each hypothesis for the first error is extended to repair the second; IntelliFix compares the lanes.", look: "Which later error sites appear under every hypothesis?" },
  { title: "Several plausible repairs", route: "/repair", example: "07_ambiguous_operator", focus: "repair:classes", body: "Two operands, no operator: +, −, *, /, comparisons … all parse.", look: "Status “Multiple plausible repairs”: margin 0 is below τ." },
  { title: "IntelliFix abstains", route: "/repair", example: "08_abstain_missing_name", focus: "repair:candidates", body: "A declaration without a name: every repair must invent one. A valid parse exists, yet IntelliFix reports low confidence.", look: "The top repair contains a __hole placeholder." },
  { title: "Accept a repair and inspect the result", route: "/repair", example: "02_missing_semicolon", focus: "repair:candidates", acceptAction: true, body: "Accepting replaces the editor content (after confirmation) and keeps the original in the undo history.", look: "Use the button below, then compare the ASTs in the AST explorer." },
  { title: "How IntelliFix is evaluated", route: "/evaluation", body: "900 seeded mutations of 30 hand-written programs, split by program into dev and test. Baselines include least-cost repair, ablations and CPCT+.", look: "Read “What the experiment shows” — including what did not improve." },
];

export function GuidedDemo() {
  const demo = useDemo();
  const p = useProject();
  const nav = useNavigate();
  const step = STEPS[demo.step];
  const [pendingRun, setPendingRun] = useState<string | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Enter a step: navigate, focus a tab, load its sample (if different).
  useEffect(() => {
    nav(step.route);
    demo.setFocus(step.focus ?? null);
    if (step.example) {
      const ex = p.examples.find((e) => e.id === step.example);
      if (ex && p.origin.exampleId !== ex.id) {
        p.loadSource(ex.source, { kind: "example", label: `${ex.id}.mc`, exampleId: ex.id });
        setPendingRun(ex.source);
      } else if (ex && (!p.repair || p.isStale(p.repair)) && !p.running.repair) {
        setPendingRun(p.source);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [demo.step, p.examples.length]);

  // Run once the newly loaded source is in place.
  useEffect(() => {
    if (pendingRun !== null && p.source === pendingRun) {
      setPendingRun(null);
      p.runAll();
    }
  }, [pendingRun, p]);

  useEffect(() => panel.current?.focus(), [demo.step]);

  const plan = p.repair?.envelope.data.repair.decision.plans[0];
  const status = p.repair && !p.isStale(p.repair) ? p.repair.envelope.data.repair.decision.status : null;
  const busy = p.running.repair || p.running.parse || p.running.lex;

  return (
    <div className="demo-panel" role="dialog" aria-label="Guided demo" ref={panel} tabIndex={-1} onKeyDown={(e) => e.key === "Escape" && demo.close()}>
      <div className="head">
        <Badge tone="accent" icon={false}>Guided demo</Badge>
        <span className="small muted">Step {demo.step + 1} of {STEPS.length}</span>
        <div style={{ flex: 1 }} />
        <button className="btn ghost sm icon" onClick={demo.close} aria-label="Exit demo"><X size={14} /></button>
      </div>
      <div className="body">
        <div className="progress" aria-hidden><div style={{ width: `${((demo.step + 1) / STEPS.length) * 100}%` }} /></div>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <p className="small"><strong>Look at:</strong> {step.look}</p>
        <div className="row small">
          {busy ? <span className="muted">Running the compiler…</span> : status ? <>Live result: <StatusBadge status={status} /></> : null}
        </div>
        {step.acceptAction && plan && status && (
          <button
            className="btn primary sm"
            onClick={() => {
              p.applyRepair(plan.source, plan.summary);
              setPendingRun(plan.source);
              nav("/ast");
              demo.setFocus("ast:compare");
            }}
          >
            Apply “{plan.summary}” and open AST compare
          </button>
        )}
        {p.examplesError && <p className="small" style={{ color: "var(--danger)" }}>Samples could not be loaded: {p.examplesError.message}</p>}
        <p className="tiny faint">All outputs are computed live by the compiler for the bundled sample shown in the editor.</p>
      </div>
      <div className="foot">
        <button className="btn sm" onClick={() => demo.setStep(demo.step - 1)} disabled={demo.step === 0}><ChevronLeft size={14} aria-hidden /> Back</button>
        <div style={{ flex: 1 }} />
        {demo.step < STEPS.length - 1 ? (
          <button className="btn primary sm" onClick={() => demo.setStep(demo.step + 1)}>Next <ChevronRight size={14} aria-hidden /></button>
        ) : (
          <button className="btn primary sm" onClick={demo.close}>Finish</button>
        )}
      </div>
    </div>
  );
}

export const DEMO_STEPS = STEPS;
