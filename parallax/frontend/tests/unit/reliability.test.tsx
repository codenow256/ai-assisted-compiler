import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { riskOf, planRisks } from "../../src/lib/explain";
import { classifyInput, completionOf, firstErrorView, unsupportedRewrite } from "../../src/lib/journey";
import type { RepairDoc } from "../../src/types/api";
import ws from "./fixtures/workspace_cases.json";
import { defaultHandlers, mockApi, renderApp } from "./helpers";

// Real backend responses (gen_workspace_fixtures.py) for the reliability acceptance examples.
type Key = keyof typeof ws.repair;
const DOC = (k: Key) => ws.repair[k].envelope.data as unknown as RepairDoc;
const SRC = (k: Key) => ws.repair[k].source;
const real = () => defaultHandlers({
  "/lex": (_p, b) => ws.repair[(Object.keys(ws.repair) as Key[]).find((k) => SRC(k) === b.source)!].envelope,
  "/parse": (_p, b) => ws.repair[(Object.keys(ws.repair) as Key[]).find((k) => SRC(k) === b.source)!].envelope,
  "/repair": (_p, b) => ws.repair[(Object.keys(ws.repair) as Key[]).find((k) => SRC(k) === b.source)!].envelope,
});
afterEach(() => vi.restoreAllMocks());

describe("repair safety", () => {
  it("the engine's complete plan for `price + ;` + `total++` deletes `+` and `++`: both flagged as code removal", () => {
    const plan = DOC("accept_rhs_pp").repair.decision.plans[0];
    expect(plan.edits.map((e) => e.removed_text)).toEqual(["+", "++"]);
    const risks = planRisks(plan);
    expect(risks).toHaveLength(2);
    expect(risks[0]).toBe("removes `+` from your code");
    expect(risks[1]).toMatch(/deletes `\+\+`, so the increment is lost .*write `x = x \+ 1`/);
  });
  it("punctuation-only fixes stay safe (missing semicolon is still recommended)", () => {
    const d = DOC("semicolon");
    expect(d.repair.decision.status).toBe("RECOMMENDED");
    expect(planRisks(d.repair.decision.plans[0])).toEqual([]);
    expect(riskOf({ op: "delete", removed_kind: "SEMI", removed_text: ";" } as never)).toBeNull();
  });
});

describe("one error at a time", () => {
  it("multi-error code is offered fixes for the first error only, decided by the engine's own rule", () => {
    const fe = firstErrorView(DOC("accept_rhs_pp"), SRC("accept_rhs_pp"))!;
    expect(fe).not.toBeNull();
    expect(fe.doc.repair.decision.plans.every((p) => p.edits.length === 1)).toBe(true);
    expect(fe.doc.repair.decision.plans.every((p) => p.edits[0].at.line === 3)).toBe(true); // all at the first error
    expect(fe.doc.repair.decision.status).not.toBe("RECOMMENDED"); // ambiguous: delete + vs fill in
    expect(fe.fullPlan!.edits).toHaveLength(2);
    // the `++` deletion bundled into each candidate is NOT part of the first-error options
    expect(fe.doc.repair.decision.plans.some((p) => p.edits.some((e) => e.removed_text === "++"))).toBe(false);
    expect(fe.doc.repair.decision.plans[0].source).toContain("total++;");
    expect(fe.doc.repair.decision.plans[0].valid).toBe(false); // later errors remain: never claimed to parse
  });
  it("a single error is not split", () => {
    expect(firstErrorView(DOC("semicolon"), SRC("semicolon"))).toBeNull();
  });
});

describe("unsupported constructs get a supported rewrite", () => {
  it("total++; → total = total + 1;", () => {
    const d = DOC("accept_pp_only");
    const r = unsupportedRewrite(SRC("accept_pp_only"), d.lexical_errors[0])!;
    expect(r.after).toBe("  total = total + 1;");
    expect(r.line).toBe(4);
  });
  it("compound assignment and decrement", () => {
    const err = { kind: "UNSUPPORTED", start: { line: 1 } } as never;
    expect(unsupportedRewrite("  x += a * 2;", err)!.after).toBe("  x = x + (a * 2);");
    expect(unsupportedRewrite("  --i;", err)!.after).toBe("  i = i - 1;");
    expect(unsupportedRewrite("  f(i++);", err)).toBeNull(); // not a simple statement: no guess
  });
});

describe("truthful status", () => {
  it("an undeclared name is reported by the compiler and blocks completion", () => {
    const d = DOC("accept_undeclared");
    expect(d.parse.ok).toBe(true);
    expect(d.parse.name_warnings![0].message).toBe("'tal' is used but not declared");
    expect(classifyInput(d, SRC("accept_undeclared"))).toBe("name-warnings");
    expect(completionOf(d)).toBe("name-warnings");
    expect(completionOf(DOC("semicolon_fixed"))).toBe("complete");
    expect(completionOf(DOC("semicolon"))).toBe("errors");
  });
});

describe("Workspace UI", () => {
  const analyze = async () => { fireEvent.click(await screen.findByTestId("analyze")); return screen.findByTestId("explanation"); };
  it("`price + ;` with `total++`: step 3 fixes the first error, asks, and warns that the complete plan removes code", async () => {
    mockApi(real());
    renderApp("/", SRC("accept_rhs_pp"));
    await analyze();
    fireEvent.click(screen.getByRole("button", { name: /^Fixes/ }));
    const panel = document.querySelector(".ws-step") as HTMLElement;
    expect(within(panel).getByText(/Several errors: fix them one at a time/)).toBeInTheDocument();
    expect(within(panel).queryByTestId("recommended")).toBeNull();
    expect(within(panel).getByTestId("clarify").textContent).toMatch(/Is the \+ extra, or is something missing after it\?/);
    fireEvent.click(within(panel).getByText(/The engine's complete plan for all errors at once/));
    const full = within(panel).getByTestId("full-plan");
    expect(full.textContent).toMatch(/This plan changes what your program does/);
    expect(full.textContent).toMatch(/increment is lost/);
    expect(within(full).getByRole("button", { name: /Choose it anyway \(I understand it removes code\)/ })).toBeInTheDocument();
  });
  it("`total++;` alone: the parser-accepted deletion is not offered; a validated rewrite is", async () => {
    mockApi(real());
    renderApp("/", SRC("accept_pp_only"));
    await analyze();
    fireEvent.click(screen.getByRole("button", { name: /^Fixes/ }));
    const rw = await screen.findByTestId("rewrite");
    expect(rw.textContent).toMatch(/total\+\+;.*total = total \+ 1;/);
    expect(within(rw).getByRole("button", { name: /Use this rewrite/ })).toBeDisabled(); // not before the parser check
  });
  it("undeclared name: not presented as valid MiniC", async () => {
    mockApi(real());
    renderApp("/", SRC("accept_undeclared"));
    const ex = await analyze();
    expect(within(ex).getByText("Syntax OK, name problems")).toBeInTheDocument();
    expect(ex.textContent).toMatch(/the name check found 1 problem: 'tal' is used but not declared \(line 4\)/);
    expect(ex.textContent).not.toMatch(/Your program is valid MiniC/);
    fireEvent.click(screen.getByRole("button", { name: /^Fixes/ }));
    expect(screen.getByText("No syntax fix needed, but a name problem remains")).toBeInTheDocument();
  });
});
