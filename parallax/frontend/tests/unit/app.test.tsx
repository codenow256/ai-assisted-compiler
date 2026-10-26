import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { DEFAULT_OPTIONS, ProjectProvider, useProject } from "../../src/app/ProjectContext";
import { CATEGORY, classifyInput } from "../../src/lib/journey";
import type { RepairDoc } from "../../src/types/api";
import summary from "../../../evaluation/results/summary.json";
import clarification from "../../../evaluation/results/clarification_bound.json";
import ambiguous from "./fixtures/repair_07_ambiguous_operator.json";
import ws from "./fixtures/workspace_cases.json";
import { defaultHandlers, fixtures, mockApi, renderApp } from "./helpers";

afterEach(() => vi.restoreAllMocks());

// Real backend responses (gen_workspace_fixtures.py), routed by the exact source text.
type Key = keyof typeof ws.repair;
const SRC = (k: Key) => ws.repair[k].source;
const byKey = (k: Key) => ws.repair[k].envelope;
function real(extra: Record<string, (path: string, body: any) => unknown> = {}, calls: string[] = []) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const pick = (body: { source: string }) => {
    const k = (Object.keys(ws.repair) as Key[]).find((x) => SRC(x) === body.source);
    if (!k) return new Response(JSON.stringify({ error: { code: "NOT_IN_FIXTURE", message: body.source } }), { status: 500 });
    calls.push(k);
    return byKey(k);
  };
  return defaultHandlers({
    "/lex": (_p, b) => pick(b),
    "/parse": (_p, b) => (b.source === SRC("missing_rhs_fixed") && b.trace === false ? ws.parse.missing_rhs_fixed : pick(b)),
    "/repair": (_p, b) => pick(b),
    "/repair/compare": (_p, b) => (b.before === SRC("missing_rhs") ? ws.compare.missing_rhs__fixed : ws.compare.plan0__plan1),
    "/evaluation/results": () => ({ summary, clarification, report_markdown: "", provenance: { file: "", generated_utc: "t", git_commit: "c", kind: "stored" } }),
    ...extra,
  });
}
const analyze = async () => fireEvent.click(await screen.findByTestId("analyze"));
const step = (name: RegExp) => fireEvent.click(screen.getByRole("button", { name }));

describe("navigation", () => {
  it("has exactly two primary destinations; Research & Method stays reachable by URL", async () => {
    mockApi(real());
    renderApp("/");
    const nav = await screen.findByRole("complementary", { name: "Primary" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent?.replace(/[a-z ,]+$/, ""))).toHaveLength(2);
    expect(within(nav).queryByRole("link", { name: /Research & Method/ })).toBeNull();
    for (const [link, heading] of [["AST Explorer", "AST Explorer"], ["Workspace", "Workspace"]]) {
      fireEvent.click(within(nav).getByRole("link", { name: new RegExp("^" + link) }));
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    }
  });
  it("specialist views stay reachable and lead back to where they belong", async () => {
    mockApi(real());
    renderApp("/lexer");
    expect(await screen.findByRole("heading", { level: 1, name: "Lexical analysis" })).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByRole("link", { name: /Workspace/ })).toHaveAttribute("href", "/");
    expect(screen.getByText(/Compiler internals · token table/)).toBeInTheDocument();
  });
  it("shows an explicit backend-offline state instead of fake data", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    renderApp("/", "int main() { return 0; }");
    expect(await screen.findByText("Backend offline")).toBeInTheDocument();
    await analyze();
    expect(await screen.findByText(/The browser cannot reach the IntelliFix backend. Your code is unchanged./)).toBeInTheDocument();
  });
});

describe("Workspace: one connected journey on real compiler output", () => {
  it("recommended fix: diagnose → compare → choose → tree → apply → verified → undo", async () => {
    const calls: string[] = [];
    mockApi(real({}, calls));
    renderApp("/", SRC("semicolon"));
    await analyze();
    const ex = await screen.findByTestId("explanation");
    expect(within(ex).getByText("Missing delimiter")).toBeInTheDocument();
    expect(ex.textContent).toMatch(/Line 3: the parser did not expect the keyword return here/);
    expect(ex.textContent).toMatch(/previous line \(2\) is missing its ;/);
    expect(ex.textContent).toMatch(/1 · Lexer.*tokens.*2 · Parser.*stopped at line 3/);
    step(/Compare fixes/);
    const rec = await screen.findByTestId("recommended");
    expect(rec.textContent).toMatch(/Insert ; at 2:12/);
    expect(rec.textContent).toMatch(/score gap of 2\.00 \(threshold τ = 1\.5\)/);
    expect(screen.getAllByTestId("fix-card").length).toBeGreaterThan(0); // the alternatives are shown too
    fireEvent.click(within(rec).getByRole("button", { name: /Use this fix/ }));
    expect(await screen.findByText(/How your chosen fix/)).toBeInTheDocument();
    step(/^Apply & verify$/);
    fireEvent.click(await screen.findByTestId("apply"));
    expect(await screen.findByText(/Verified: every check IntelliFix performs passes on the current code/)).toBeInTheDocument();
    expect(screen.getByTestId("completion").textContent).toMatch(/Not checked by IntelliFix:.*run-time behaviour/);
    expect(calls).toContain("semicolon_fixed"); // re-analysis ran on the repaired text
    expect(screen.getByText(/No longer reported \(1\)/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("verify")).getByRole("button", { name: /Undo repair/ }));
    await waitFor(() => expect(screen.queryByText(/1 repair applied/)).not.toBeInTheDocument());
  });

  it("ambiguity: a targeted question, a real fill-in validated by the parser, then apply and verify", async () => {
    mockApi(real());
    renderApp("/", SRC("missing_rhs"));
    await analyze();
    await screen.findByTestId("explanation");
    step(/^Fixes/);
    const q = await screen.findByTestId("clarify");
    expect(q.textContent).toMatch(/Is the \+ extra, or is something missing after it\?/);
    expect(q.textContent).toMatch(/score gap 0\.50, below the threshold τ = 1\.5/);
    const use = within(q).getByRole("button", { name: /Use this answer/ });
    expect(use).toBeDisabled(); // nothing is used before the parser has checked it
    fireEvent.click(within(q).getByText("Fill in the missing value or expression yourself"));
    fireEvent.click(within(q).getByRole("button", { name: "price" }));
    fireEvent.click(within(q).getByRole("button", { name: "Check with the parser" }));
    expect(await within(q).findByText("Valid MiniC")).toBeInTheDocument();
    fireEvent.click(use);
    expect(await screen.findByText(/Partial tree → complete tree/)).toBeInTheDocument();
    expect(screen.getByText(/the parser skipped/)).toBeInTheDocument();
    step(/^Apply & verify$/);
    fireEvent.click(await screen.findByTestId("apply"));
    expect(await screen.findByText(/Verified/)).toBeInTheDocument();
  });

  it("ambiguity: leaving it unresolved changes nothing; a custom line is also checked by the parser", async () => {
    mockApi(real());
    renderApp("/", SRC("missing_rhs"));
    await analyze();
    await screen.findByTestId("explanation");
    step(/^Fixes/);
    const q = await screen.findByTestId("clarify");
    fireEvent.click(within(q).getByRole("button", { name: /Leave it unresolved/ }));
    expect(await screen.findByText(/Left unresolved/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Reopen the question/ }));
    const q2 = await screen.findByTestId("clarify");
    fireEvent.click(within(q2).getByText(/Something else: write line 3/));
    fireEvent.change(within(q2).getByLabelText("Your version of line 3"), { target: { value: "  int total = price + price ;" } });
    fireEvent.click(within(q2).getByRole("button", { name: "Check with the parser" }));
    expect(await within(q2).findByText("Valid MiniC")).toBeInTheDocument();
    expect(within(q2).getByRole("button", { name: /Use this answer/ })).toBeEnabled();
  });

  it("several errors: the first is reliable, later reports carry evidence", async () => {
    mockApi(real());
    renderApp("/", SRC("two_errors"));
    await analyze();
    const ex = await screen.findByTestId("explanation");
    expect(within(ex).getByText(/3 error reports — which one matters\?/)).toBeInTheDocument();
    expect(within(ex).getByText("first error (reliable)")).toBeInTheDocument();
    expect(within(ex).getAllByText("likely independent of the first")).toHaveLength(2);
    expect(ex.textContent).toMatch(/likely, not proven/);
  });

  it("progressive hints, then the student's own fix is checked by a real re-run", async () => {
    mockApi(real());
    let ctx: ReturnType<typeof useProject> | null = null;
    function Probe() { const p = useProject(); useEffect(() => { ctx = p; }); return null; }
    renderApp("/", SRC("semicolon"), <Probe />);
    await analyze();
    await screen.findByTestId("explanation");
    fireEvent.click(await screen.findByRole("button", { name: /Show a hint/ }));
    expect(await screen.findByText(/Look at line 3/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Next hint \(2\/3\)/ }));
    fireEvent.click(screen.getByRole("button", { name: /Next hint \(3\/3\)/ }));
    expect(screen.getByText(/Fixes the parser accepted/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /I'll try it in the editor/ }));
    act(() => ctx!.setSource(SRC("semicolon_fixed")));
    fireEvent.click(within(screen.getByTestId("practice")).getByRole("button", { name: "Check my fix" }));
    expect(await screen.findByText("Your fix works: the program now parses.")).toBeInTheDocument();
  });

  const keys = Object.keys(ws.repair) as Key[];
  for (const k of keys) {
    it(`every input category gets a meaningful response: ${k}`, async () => {
      mockApi(real());
      renderApp("/", SRC(k));
      await analyze();
      const ex = await screen.findByTestId("explanation");
      const doc = byKey(k).data as unknown as RepairDoc;
      const cat = classifyInput(doc, SRC(k));
      expect(within(ex).getByText(CATEGORY[cat].label)).toBeInTheDocument();
      expect(ex.textContent).toMatch(/Next:/);
      expect(ex.textContent).not.toMatch(/undefined|NaN|\[object Object\]/);
      if (["empty", "whitespace", "comments_only"].includes(k)) expect(within(ex).getByRole("button", { name: "Load a sample program" })).toBeInTheDocument();
      step(/^Fixes/);
      // the Fixes step always says something: a fix, a question, or why there is none
      expect(document.querySelector(".ws-step")!.textContent!.length).toBeGreaterThan(60);
    });
  }

  it("unsupported C: no fix is offered, the parser-accepted edits are listed as not offered", async () => {
    mockApi(real());
    renderApp("/", SRC("unsupported"));
    await analyze();
    await screen.findByTestId("explanation");
    step(/^Fixes/);
    const panel = document.querySelector(".ws-step") as HTMLElement;
    expect(within(panel).getByText("IntelliFix does not propose a fix here")).toBeInTheDocument();
    expect(within(panel).queryByRole("button", { name: /Choose this fix|Use this fix/ })).toBeNull();
    expect(within(panel).getByText(/not offered, because they change what the program means/)).toBeInTheDocument();
    expect(within(panel).getByLabelText(/Your version of line/)).toBeInTheDocument();
  });

  it("unterminated comment: no question with zero options; explains why and offers the user's own line", async () => {
    mockApi(real());
    renderApp("/", SRC("unterminated"));
    await analyze();
    await screen.findByTestId("explanation");
    step(/^Fixes/);
    const panel = document.querySelector(".ws-step") as HTMLElement;
    expect(within(panel).queryByTestId("clarify")).toBeNull();
    expect(panel.textContent).not.toMatch(/0 structurally different/);
    expect(panel.textContent).toMatch(/delete the unterminated comment together with the code hidden inside it/);
    expect(within(panel).getByLabelText(/Your version of line/)).toBeInTheDocument();
  });

  it("a compiler failure is reported as such; the code is kept", async () => {
    const missing = () => new Response(JSON.stringify({ error: { code: "COMPILER_UNAVAILABLE", message: "The parallaxc compiler binary was not found or is not executable.", hint: "cmake" } }), { status: 503 });
    mockApi(defaultHandlers({ "/lex": missing, "/parse": missing, "/repair": missing }));
    renderApp("/", "int main() { return 0; }");
    await analyze();
    expect(await screen.findByText("Compiler not built")).toBeInTheDocument();
    expect(screen.getByText(/No analysis result exists, so none is shown. Your code is unchanged./)).toBeInTheDocument();
  });

  it("input that is too large is refused with a clear message", async () => {
    const tooLarge = () => new Response(JSON.stringify({ error: { code: "INPUT_TOO_LARGE", message: "Source exceeds 65536 characters.", hint: "Split the program or shorten it." } }), { status: 413 });
    mockApi(defaultHandlers({ "/lex": tooLarge, "/parse": tooLarge, "/repair": tooLarge }));
    renderApp("/", "int x;\n");
    await analyze();
    expect(await screen.findByText(/The backend accepts at most 64 KB; nothing was analyzed./)).toBeInTheDocument();
  });
});

describe("AST Explorer", () => {
  it("parses on open, explains a selected node with its grammar rule, tokens and expression diagram", async () => {
    mockApi(real());
    renderApp("/ast", SRC("valid"));
    const tree = await screen.findByRole("tree", { name: "Abstract syntax tree" });
    const plus = within(tree).getAllByRole("treeitem").find((n) => /Binary\s*\+/.test(n.textContent ?? ""))!;
    fireEvent.click(plus);
    const card = screen.getByTestId("node-card");
    expect(card.textContent).toMatch(/add_expr → add_expr '\+' mul_expr/);
    expect(card.textContent).toMatch(/Inside Assign as the new value/);
    expect(card.textContent).toMatch(/\+ stored as the operator \(op\)/);
    expect(within(card).getByRole("img", { name: /Expression tree/ })).toBeInTheDocument();
    // navigation: parent link moves the selection
    fireEvent.click(within(card).getByRole("button", { name: "Assign" }));
    expect(screen.getByTestId("node-card").textContent).toMatch(/assignment → lvalue '=' expr/);
    // search marks nodes
    fireEvent.change(screen.getByPlaceholderText(/Find:/), { target: { value: "square" } });
    expect(document.querySelectorAll(".orow.hit").length).toBeGreaterThanOrEqual(2);
  });

  it("invalid code gets a labelled partial tree, never an invented complete one", async () => {
    mockApi(real());
    renderApp("/ast", SRC("missing_rhs"));
    expect(await screen.findByText("Partial tree: your code has syntax errors")).toBeInTheDocument();
    expect(screen.getByText("Partial tree of your code (it has syntax errors)")).toBeInTheDocument();
    expect([...document.querySelectorAll(".okind")].some((e) => e.textContent === "Error")).toBe(true);
  });

  it("before & after compares two real repairs node by node", async () => {
    mockApi(real());
    renderApp("/", SRC("missing_operator"));
    await analyze();
    await screen.findByTestId("explanation");
    fireEvent.click(within(screen.getByRole("complementary", { name: "Primary" })).getByRole("link", { name: /^AST Explorer/ }));
    fireEvent.click(await screen.findByRole("tab", { name: /Before/ }));
    expect(await screen.findByText("1 structural change(s)")).toBeInTheDocument();
    expect(screen.getByText("Binary op=+")).toBeInTheDocument();
    expect(screen.getByText("Binary op=-")).toBeInTheDocument();
  });
});

describe("Research & Method", () => {
  it("shows the key numbers exactly as stored, labelled honestly", async () => {
    mockApi(real());
    renderApp("/research");
    await screen.findByText(/Research question\./);
    const t = summary.test as any; // eslint-disable-line @typescript-eslint/no-explicit-any
    const p = (x: number) => `${(100 * x).toFixed(1)}%`;
    const body = document.body.textContent!;
    expect(body).toContain(`${p(t.P.top1_ast.rate)} (${t.P.top1_ast.k}/${t.P.top1_ast.n})`);
    expect(body).toContain(`${p(t.C.top1_ast.rate)} (${t.C.top1_ast.k}/${t.C.top1_ast.n})`);
    expect(body).toContain(`+${(100 * summary.paired_tests.top1_ast_P_minus_C.diff).toFixed(1)} points`);
    expect(body).toContain(`${p(t.F.false_confident_rate.rate)} to ${p(t.P.false_confident_rate.rate)}`);
    expect(body).toContain(`${p(t.P.coverage.rate)} of test cases (${t.P.coverage.k}/${t.P.coverage.n})`);
    expect(body).toContain(`in ${clarification.test.oracle_user.k} (${p(clarification.test.oracle_user.rate)})`);
    expect(body).toMatch(/Simulation, not a user study/);
    expect(body).toMatch(/synthetic/);
    expect(body).toMatch(/no general superiority is claimed/);
    expect(body).not.toMatch(/better than CPCT\+|probability of being correct/);
  });
});

describe("specialist pages (contextual links)", () => {
  it("repair laboratory: accept requires confirmation and can be undone", async () => {
    const src = fixtures.examples.examples.find((e) => e.id === "02_missing_semicolon")!.source;
    let repairCalls = 0;
    mockApi(defaultHandlers({ "/repair": () => (repairCalls++, fixtures.semicolon) }));
    renderApp("/repair", src);
    fireEvent.click((await screen.findAllByRole("button", { name: /Run repair/ }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(screen.getByText(/Replace the editor content/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("1 repair applied")).toBeInTheDocument();
    await waitFor(() => expect(repairCalls).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(screen.queryByText("1 repair applied")).not.toBeInTheDocument());
  });
  it("repair laboratory lists AST classes and the multiple-plausible decision", async () => {
    mockApi(defaultHandlers({ "/repair": () => ambiguous }));
    renderApp("/repair", "int combine(int a, int b) {\n  int c = a b;\n  return c;\n}\n");
    fireEvent.click((await screen.findAllByRole("button", { name: /Run repair/ }))[0]);
    expect(await screen.findAllByText("Multiple plausible repairs")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: /AST classes/ }));
    expect(await screen.findByText(/structurally distinct outcomes/)).toBeInTheDocument();
  });
  it("full evaluation data renders stored results with provenance and caveats", async () => {
    mockApi(defaultHandlers({ "/evaluation/results": () => ({ summary, report_markdown: "# r", provenance: { file: "x", generated_utc: summary.environment.timestamp_utc, git_commit: summary.environment.git_commit, kind: "stored results" } }) }));
    renderApp("/evaluation");
    expect(await screen.findByText("What the experiment shows")).toBeInTheDocument();
    expect(screen.getByText(/synthetic token mutations, not real student code/)).toBeInTheDocument();
  });
  it("explains missing results", async () => {
    mockApi(defaultHandlers({ "/evaluation/results": () => new Response(JSON.stringify({ error: { code: "RESULTS_NOT_FOUND", message: "No stored evaluation results.", hint: "run it" } }), { status: 404 }) }));
    renderApp("/research");
    expect(await screen.findByText("No stored evaluation results")).toBeInTheDocument();
  });
});

describe("stale responses", () => {
  it("applies only the newest repair response", async () => {
    let call = 0;
    let releaseFirst: () => void = () => {};
    mockApi(
      defaultHandlers({
        "/repair": () => {
          call++;
          if (call === 1) return new Promise((res) => (releaseFirst = () => res({ ...fixtures.semicolon, run_id: "old" })));
          return { ...fixtures.semicolon, run_id: "new" };
        },
      }),
    );
    let ctx: ReturnType<typeof useProject> | null = null;
    function Probe() {
      const p = useProject();
      useEffect(() => {
        ctx = p;
      });
      return <div data-testid="run">{p.repair?.envelope.run_id ?? "none"}</div>;
    }
    render(
      <ProjectProvider initialSource="int x">
        <Probe />
      </ProjectProvider>,
    );
    await act(async () => {
      ctx!.runRepair();
    });
    await act(async () => {
      await ctx!.runRepair();
    });
    expect(screen.getByTestId("run").textContent).toBe("new");
    await act(async () => releaseFirst());
    expect(screen.getByTestId("run").textContent).toBe("new");
    expect(DEFAULT_OPTIONS.abstention).toBe(true);
  });
});
