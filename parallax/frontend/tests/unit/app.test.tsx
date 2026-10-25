import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect } from "react";
import { DEFAULT_OPTIONS, ProjectProvider, useProject } from "../../src/app/ProjectContext";
import summary from "../../../evaluation/results/summary.json";
import ambiguous from "./fixtures/repair_07_ambiguous_operator.json";
import { defaultHandlers, fixtures, mockApi, renderApp } from "./helpers";

afterEach(() => vi.restoreAllMocks());

describe("navigation", () => {
  it("renders every section from the sidebar", async () => {
    mockApi(defaultHandlers({ "/docs": () => ({ docs: [] }), "/docs/README": () => ({ name: "README", markdown: "# Hi" }), "/evaluation/results": () => ({ summary, report_markdown: "", provenance: { file: "", generated_utc: "t", git_commit: "c", kind: "stored" } }) }));
    renderApp("/");
    expect(await screen.findByRole("heading", { level: 1, name: "IntelliFix" })).toBeInTheDocument();
    const pages: [string, string][] = [
      ["Code workbench", "Code workbench"],
      ["Lexical analysis", "Lexical analysis"],
      ["Grammar & parsing", "Grammar & parsing"],
      ["AST explorer", "AST explorer"],
      ["Repair laboratory", "Repair laboratory"],
      ["Hypothesis explorer", "Hypothesis explorer"],
      ["Evaluation & impact", "Evaluation & impact"],
      ["Learning center", "Learning center"],
      ["Documentation & about", "Documentation & about"],
    ];
    for (const [link, heading] of pages) {
      fireEvent.click(screen.getByRole("link", { name: link }));
      expect(await screen.findByRole("heading", { level: 1, name: heading })).toBeInTheDocument();
    }
  });

  it("shows an explicit backend-offline state instead of fake data", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Failed to fetch"));
    renderApp("/");
    expect(await screen.findByText("The backend is not reachable")).toBeInTheDocument();
    expect(screen.getByText("Backend offline")).toBeInTheDocument();
  });
});

describe("workbench and repair laboratory", () => {
  it("loads a sample, runs the real-response pipeline and shows the decision", async () => {
    mockApi(defaultHandlers({ "/lex": () => ({ data: fixtures.semicolon.data }), "/parse": () => ({ data: fixtures.semicolon.data }), "/repair": () => fixtures.semicolon }));
    renderApp("/workbench");
    const select = await screen.findByLabelText("Sample program");
    await waitFor(() => expect(screen.getAllByRole("option").length).toBeGreaterThan(5));
    fireEvent.change(select, { target: { value: "02_missing_semicolon" } });
    fireEvent.click(screen.getAllByRole("button", { name: /^Analyze$/ })[0]);
    expect(await screen.findAllByText("Recommended repair")).not.toHaveLength(0);
    const ex = screen.getByTestId("explanation");
    // plain-language explanation built from the real diagnostic and decision
    expect(ex.textContent).toMatch(/Line 4: the parser did not expect the type keyword int here/);
    expect(ex.textContent).toMatch(/The type keyword int starts a new line.*previous line \(3\) is missing its ;/);
    expect(ex.textContent).toMatch(/everything up to and including the value 0 \(line 3\) is valid MiniC.*IntelliFix recommends one fix: insert ; at 3:16/);
    expect(document.body.textContent).toMatch(/Insert ; at 3:16/);
  });

  it("Run lexer and Run parser show their results on the workbench itself", async () => {
    const lexData = { ...fixtures.semicolon.data };
    mockApi(defaultHandlers({ "/lex": () => ({ ...fixtures.semicolon, data: lexData }), "/parse": () => fixtures.semicolon }));
    const src = fixtures.examples.examples.find((e) => e.id === "02_missing_semicolon")!.source;
    renderApp("/workbench", src);
    expect(within(await screen.findByTestId("run-lex")).getByText("not run yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Run lexer/ }));
    expect(await within(screen.getByTestId("run-lex")).findByText(/38 tokens, 0 lexical error/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Run parser/ }));
    expect(await within(screen.getByTestId("run-parse")).findByText(/rejected: unexpected type-keyword 'int' at 4:3/)).toBeInTheDocument();
  });

  it("shows a compiler-unavailable error in the run row instead of a result", async () => {
    mockApi(defaultHandlers({ "/lex": () => new Response(JSON.stringify({ error: { code: "COMPILER_UNAVAILABLE", message: "The parallaxc compiler binary was not found or is not executable.", hint: "cmake" } }), { status: 503 }) }));
    renderApp("/workbench", "int main() { return 0; }");
    fireEvent.click(await screen.findByRole("button", { name: /Run lexer/ }));
    expect(await within(screen.getByTestId("run-lex")).findByText(/COMPILER_UNAVAILABLE/)).toBeInTheDocument();
    expect(screen.getByText("Compiler not built")).toBeInTheDocument();
  });

  it("accept requires confirmation and can be undone", async () => {
    const src = fixtures.examples.examples.find((e) => e.id === "02_missing_semicolon")!.source;
    let repairCalls = 0;
    mockApi(defaultHandlers({ "/repair": () => (repairCalls++, fixtures.semicolon) }));
    renderApp("/repair", src);
    fireEvent.click((await screen.findAllByRole("button", { name: /Run repair/ }))[0]);
    fireEvent.click(await screen.findByRole("button", { name: "Accept" }));
    expect(screen.getByText(/Replace the editor content/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(await screen.findByText("1 repair applied")).toBeInTheDocument();
    // applying re-analyzes the repaired source with the real pipeline (here: the mocked API)
    await waitFor(() => expect(repairCalls).toBe(2));
    fireEvent.click(screen.getByRole("button", { name: /Undo/ }));
    await waitFor(() => expect(screen.queryByText("1 repair applied")).not.toBeInTheDocument());
  });

  it("lists AST classes and the multiple-plausible decision", async () => {
    mockApi(defaultHandlers({ "/repair": () => ambiguous }));
    renderApp("/repair", "int combine(int a, int b) {\n  int c = a b;\n  return c;\n}\n");
    fireEvent.click((await screen.findAllByRole("button", { name: /Run repair/ }))[0]);
    expect(await screen.findAllByText("Multiple plausible repairs")).not.toHaveLength(0);
    fireEvent.click(screen.getByRole("tab", { name: /AST classes/ }));
    expect(await screen.findByText(/structurally distinct outcomes/)).toBeInTheDocument();
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

describe("evaluation page", () => {
  it("renders stored results with provenance and caveats", async () => {
    mockApi(defaultHandlers({ "/evaluation/results": () => ({ summary, report_markdown: "# r", provenance: { file: "x", generated_utc: summary.environment.timestamp_utc, git_commit: summary.environment.git_commit, kind: "stored results" } }) }));
    renderApp("/evaluation");
    expect(await screen.findByText("What the experiment shows")).toBeInTheDocument();
    expect(screen.getByText(/synthetic token mutations, not real student code/)).toBeInTheDocument();
    const top1 = `${(100 * summary.test.P.top1_ast.rate).toFixed(1)}%`;
    expect(screen.getAllByText(top1).length).toBeGreaterThan(0);
  });

  it("explains missing results", async () => {
    mockApi(defaultHandlers({ "/evaluation/results": () => new Response(JSON.stringify({ error: { code: "RESULTS_NOT_FOUND", message: "No stored evaluation results.", hint: "run it" } }), { status: 404 }) }));
    renderApp("/evaluation");
    expect(await screen.findByText("No stored evaluation results")).toBeInTheDocument();
  });
});
