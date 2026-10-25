import { describe, expect, it } from "vitest";
import { CATEGORY, classifyError, classifyInput, compareDiagnostics, describeAmbiguity, diagnosticRoles, differsFromTop, planCards, practiceFeedback, replaceLine, type InputCategory } from "../../src/lib/journey";
import { explain } from "../../src/lib/explain";
import { ApiError } from "../../src/services/api";
import type { Diagnostic, RepairDoc } from "../../src/types/api";
import cases from "./fixtures/explain_cases.json";

// Real compiler responses (gen_explain_fixtures.py).
const ALL = cases as unknown as Record<string, { title: string; source: string; doc: RepairDoc }>;
const get = (id: string) => ALL[id];

describe("every input gets a category, an honest statement and a next action", () => {
  const expected: Record<string, InputCategory> = {
    X01_missing_rhs: "missing-content",
    X02_eof_in_block: "incomplete-code",
    X03_two_errors: "multiple-errors",
    X04_empty: "empty",
    X05_whitespace: "whitespace",
    X06_comments_only: "comments-only",
    X07_unterminated_comment: "unterminated-comment",
    X08_unsupported: "unsupported",
    X09_deep_nesting: "resource-limit",
    X10_invalid_char: "lexical",
    X11_missing_operator: "ambiguous",
    X12_missing_name: "missing-content",
    X13_not_code: "no-safe-repair",
    X14_valid: "valid",
    X15_missing_semicolon: "missing-delimiter",
    X16_unfinished_function: "incomplete-code",
    X17_long_valid: "valid",
  };
  for (const [id, cat] of Object.entries(expected)) {
    it(`${id} → ${cat}`, () => {
      const { doc, source } = get(id);
      expect(classifyInput(doc, source)).toBe(cat);
      const e = explain(doc, source);
      expect(e.headline.length).toBeGreaterThan(10);
      expect(e.nextSteps.length).toBeGreaterThan(0);
    });
  }
  it("all 105 real inputs map to a described category", () => {
    for (const { doc, source } of Object.values(ALL)) {
      const c = classifyInput(doc, source);
      expect(CATEGORY[c].label).toBeTruthy();
      expect(CATEGORY[c].establishes.length).toBeGreaterThan(10);
      expect(CATEGORY[c].next.length).toBeGreaterThan(5);
    }
  });
  it("request failures are categories too, never fake results", () => {
    expect(classifyError(new ApiError("INPUT_TOO_LARGE", "x"))).toBe("too-large");
    expect(classifyError(new ApiError("BACKEND_UNAVAILABLE", "x"))).toBe("backend-offline");
    expect(classifyError(new ApiError("COMPILER_UNAVAILABLE", "x"))).toBe("compiler-failure");
    expect(classifyError(new ApiError("COMPILER_TIMEOUT", "x"))).toBe("compiler-failure");
    expect(CATEGORY["compiler-failure"].establishes).toMatch(/Your code is unchanged/);
  });
  it("empty and whitespace input say there is no program to analyze", () => {
    expect(explain(get("X04_empty").doc, "").headline).toMatch(/no program to analyze/);
    expect(explain(get("X05_whitespace").doc, get("X05_whitespace").source).headline).toMatch(/Only whitespace/);
  });
  it("an unterminated comment is explained, and no fix that deletes hidden code is offered", () => {
    const { doc, source } = get("X07_unterminated_comment");
    const e = explain(doc, source);
    expect(e.headline).toMatch(/comment that starts on line 2 never ends/);
    expect(e.question).toBeUndefined();
  });
});

describe("ambiguity: what is ambiguous, and a targeted question", () => {
  it("operator with nothing after it", () => {
    const a = describeAmbiguity(get("X01_missing_rhs").doc);
    expect(a.question).toBe("Is the `+` extra, or is something missing after it?");
    expect(a.what).toMatch(/score gap 0\.50, below the threshold τ = 1\.5/);
  });
  it("two values with no operator", () => {
    const a = describeAmbiguity(get("X11_missing_operator").doc);
    expect(a.question).toBe("Which operator did you mean between `a` and `b`?");
    expect(a.what).toMatch(/`\+`, `-`, `\*`/);
  });
  it("an invalid character in operator position", () => {
    expect(describeAmbiguity(get("X10_invalid_char").doc).question).toBe("What did you mean by `@`?");
  });
  it("a missing declaration name", () => {
    expect(describeAmbiguity(get("X12_missing_name").doc).question).toBe("What should the name be?");
  });
  it("every abstaining real case gets a non-empty question", () => {
    for (const { doc } of Object.values(ALL)) {
      const st = doc.repair.decision.status;
      if ((st === "MULTIPLE_PLAUSIBLE" || st === "LOW_CONFIDENCE") && doc.repair.decision.plans.length) {
        const a = describeAmbiguity(doc);
        expect(a.question).toMatch(/\?$/);
        expect(a.what).not.toMatch(/undefined|NaN/);
      }
    }
  });
});

describe("error cascade: first error vs later reports, with evidence", () => {
  it("two independent errors: later reports survive the first fix", () => {
    const roles = diagnosticRoles(get("X03_two_errors").doc);
    expect(roles.map((r) => r.role)).toEqual(["first", "likely-separate", "likely-separate"]);
    expect(roles[1].evidence).toMatch(/Still reported after the first error is fixed \(insert ';' at 2:12\)/);
    expect(roles[1].evidence).toMatch(/likely, not proven/);
  });
  it("roles exist for every real diagnostic list; only the first is called reliable", () => {
    let consequences = 0;
    for (const { doc } of Object.values(ALL)) {
      const roles = diagnosticRoles(doc);
      expect(roles.length).toBe(doc.parse.diagnostics.length);
      if (roles.length) expect(roles[0].role).toBe("first");
      expect(roles.slice(1).every((r) => r.role !== "first")).toBe(true);
      consequences += roles.filter((r) => r.role === "likely-consequence").length;
    }
    expect(consequences).toBeGreaterThan(0); // some real cases show pure cascades
  });
});

describe("repair comparison cards", () => {
  it("shows each real plan's edit, line change, validity, cost and score gap", () => {
    const { doc, source } = get("X11_missing_operator");
    const cards = planCards(doc, source);
    expect(cards.length).toBe(doc.repair.decision.plans.length);
    expect(cards[0].lines).toEqual([{ line: 4, before: "  int c = a b;", after: "  int c = a + b;" }]);
    expect(cards.every((c) => c.valid)).toBe(true);
    expect(cards[0].behind).toBe(0);
    expect(cards[1].behind).toBeGreaterThanOrEqual(0);
    expect(cards[0].evidence.some((e) => e.name === "resolves_all_errors")).toBe(true);
    expect(differsFromTop(cards, 0)).toMatch(/Top-ranked/);
  });
  it("marks placeholders and explains how an option differs", () => {
    const { doc, source } = get("X01_missing_rhs");
    const cards = planCards(doc, source);
    const hole = cards.find((c) => c.placeholder)!;
    expect(hole.plan.edits[0].text).toBe("true");
    expect(differsFromTop(cards, hole.index)).toMatch(/invents a placeholder/);
    expect(differsFromTop(cards, 1)).toMatch(/Scores 0\.50 lower than option 1; costs more to edit \(1\.5 vs 1\)/);
  });
});

describe("re-parse verification and practice feedback", () => {
  const D = (message: string, line: number) => ({ message, start: { line, column: 1, offset: 0 } }) as unknown as Diagnostic;
  it("diagnostics that disappear, remain or are new", () => {
    const r = compareDiagnostics([D("unexpected keyword 'if'", 3), D("unexpected keyword 'return'", 6)], [D("unexpected keyword 'return'", 6), D("unexpected end of input", 9)]);
    expect(r.fixed.map((d) => d.message)).toEqual(["unexpected keyword 'if'"]);
    expect(r.remaining.map((d) => d.message)).toEqual(["unexpected keyword 'return'"]);
    expect(r.added.map((d) => d.message)).toEqual(["unexpected end of input"]);
  });
  it("accepted, progress, not fixed, incomplete, unsupported, lexical", () => {
    expect(practiceFeedback(3, get("X14_valid").doc).tone).toBe("success");
    expect(practiceFeedback(2, get("X15_missing_semicolon").doc).title).toMatch(/Progress: the error on line 2 is gone/);
    expect(practiceFeedback(3, get("X15_missing_semicolon").doc).title).toBe("Not fixed yet.");
    expect(practiceFeedback(5, get("X15_missing_semicolon").doc).title).toMatch(/earlier error/);
    expect(practiceFeedback(2, get("X16_unfinished_function").doc).title).toMatch(/Incomplete/);
    expect(practiceFeedback(2, get("X08_unsupported").doc).title).toMatch(/C, not MiniC/);
    expect(practiceFeedback(2, get("X10_invalid_char").doc).title).toMatch(/lexer rejects/);
    expect(practiceFeedback(1, get("X04_empty").doc).title).toMatch(/empty/);
  });
  it("a custom answer replaces exactly one line", () => {
    expect(replaceLine("a\nb\nc", 2, "B")).toBe("a\nB\nc");
    expect(replaceLine("a", 5, "B")).toBe("a");
  });
});
