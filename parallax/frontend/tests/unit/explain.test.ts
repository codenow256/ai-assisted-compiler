import { describe, expect, it } from "vitest";
import { clarifyOptions, describeExpected, explain, namesDeclaredBefore, spliceBytes, summarizeProgram } from "../../src/lib/explain";
import { NODE_INFO, infoFor } from "../../src/lib/astInfo";
import type { RepairDoc } from "../../src/types/api";
import cases from "./fixtures/explain_cases.json";

// Real compiler responses (gen_explain_fixtures.py) for all 88 professor-style cases + extras.
const ALL = cases as unknown as Record<string, { title: string; source: string; doc: RepairDoc }>;
const text = (e: ReturnType<typeof explain>) => [e.headline, ...e.paragraphs, e.expected ?? "", ...(e.hints ?? []), ...e.nextSteps, ...(e.cascade?.lines ?? [])].join(" ");

describe("explanations for every professor-style input (real compiler output)", () => {
  const ids = Object.keys(ALL);
  it("covers at least 90 inputs", () => expect(ids.length).toBeGreaterThanOrEqual(90));
  for (const id of ids) {
    it(`${id}: ${ALL[id].title}`, () => {
      const { doc, source } = ALL[id];
      const e = explain(doc, source);
      const t = text(e);
      expect(e.headline.length).toBeGreaterThan(10);
      expect(e.nextSteps.length).toBeGreaterThan(0);
      expect(t).not.toMatch(/undefined|NaN|\[object Object\]|null\b/);
      if (doc.parse.ok && doc.parse.name_warnings?.length && doc.tokens.length) {
        // valid syntax but the (implemented) name check failed: never presented as success
        expect(e.tone).toBe("warning");
        expect(e.headline).toMatch(/syntax is valid, but the name check found/);
      } else if (doc.parse.ok) {
        expect(e.tone).toBe("success");
        expect(t).toMatch(/does not mean the program is semantically correct|nothing to analyse|does nothing/);
      } else {
        expect(e.tone).not.toBe("success");
        if (!doc.parse.resource_limit) {
          expect(e.location).toBeDefined();
          expect(e.hints?.length).toBe(3);
        }
        const st = doc.repair.decision.status;
        if ((st === "MULTIPLE_PLAUSIBLE" || st === "LOW_CONFIDENCE") && doc.repair.decision.plans.length) {
          // ask, unless every candidate would discard code hidden in an unterminated comment
          const allDiscard = doc.repair.decision.plans.every((pl) => pl.edits.some((x) => x.removed_kind === "ERROR" && (x.removed_text ?? "").startsWith("/*")));
          if (allDiscard) expect(e.question).toBeUndefined();
          else expect(e.question?.options.length).toBeGreaterThan(0);
        }
        if (st === "RECOMMENDED") expect(t).toMatch(/does not prove it is what you meant/);
      }
    });
  }
});

describe("specific behaviours", () => {
  it("`int total = price + ;` asks instead of inventing, and offers only names in scope", () => {
    const { doc, source } = ALL.X01_missing_rhs;
    const e = explain(doc, source);
    expect(doc.repair.decision.status).toBe("MULTIPLE_PLAUSIBLE");
    const fill = e.question!.options.find((o) => o.fill);
    expect(fill?.fill?.suggestions).toEqual(["price"]); // `total` is still being declared
    expect(e.question!.options.some((o) => o.label.includes("Delete `+`"))).toBe(true);
    expect(e.expected).toMatch(/value or expression/);
  });
  it("missing variable name is low confidence with a name fill-in", () => {
    const { doc, source } = ALL.P36;
    const e = explain(doc, source);
    expect(doc.repair.decision.status).toBe("LOW_CONFIDENCE");
    expect(e.question!.options[0].fill?.kind).toBe("name");
    expect(text(e)).toMatch(/cannot be recovered|placeholder/);
  });
  it("cascades are explained with evidence, not asserted", () => {
    const e = explain(ALL.X03_two_errors.doc, ALL.X03_two_errors.source);
    expect(e.cascade?.total).toBeGreaterThan(1);
    expect(e.cascade!.lines.join(" ")).toMatch(/2 separate edits/);
    expect(e.cascade!.lines.join(" ")).toMatch(/likely, not proven/);
  });
  it("unsupported C, empty input, nesting limit and lexical errors get their own explanation", () => {
    expect(explain(ALL.P65.doc, ALL.P65.source).headline).toMatch(/This is C, not MiniC/);
    expect(explain(ALL.P53.doc, ALL.P53.source).headline).toMatch(/empty/);
    expect(explain(ALL.P86.doc, ALL.P86.source).headline).toMatch(/nests deeper/);
    expect(explain(ALL.P43.doc, ALL.P43.source).headline).toMatch(/not part of MiniC/);
    expect(explain(ALL.X02_eof_in_block.doc, ALL.X02_eof_in_block.source).headline).toMatch(/file ends before/);
  });
  it("never offers to discard code hidden in an unterminated comment (P73)", () => {
    const e = explain(ALL.P73.doc, ALL.P73.source);
    expect(e.question?.options ?? []).toHaveLength(0);
    expect(e.hints![2]).not.toMatch(/replace `\/\*`/);
  });
  it("offers one fill-in per position (P75) and points to the earlier line where the fix is (P35)", () => {
    expect(clarifyOptions(ALL.P75.doc).filter((o) => o.fill)).toHaveLength(1);
    expect(explain(ALL.P35.doc, ALL.P35.source).paragraphs.join(" ")).toMatch(/noticed the problem on line 8, but the top-ranked fix changes \*\*line 4\*\*/);
  });
  it("explains that statements must be inside a function (P05)", () => {
    expect(explain(ALL.P05.doc, ALL.P05.source).paragraphs.join(" ")).toMatch(/must be inside a function body/);
  });
  it("summarises a valid program from its real AST", () => {
    const f = summarizeProgram(ALL.P19.doc.parse.ast!).join(" ");
    expect(f).toMatch(/1 function: `int fact\(n\)`/);
    expect(f).toMatch(/function call/);
  });
  it("clarify options for an ambiguous operator are the real plans", () => {
    const opts = clarifyOptions(ALL.P39.doc);
    expect(opts.map((o) => o.source).every(Boolean)).toBe(true);
    expect(opts[0].label).toMatch(/Insert `\+`/);
  });
});

describe("helpers", () => {
  it("describes expected tokens in words", () => {
    expect(describeExpected([";"])).toBe("a semicolon `;`");
    expect(describeExpected(["+", "-", "*", "/", ";", ","])).toMatch(/operator.*semicolon.*comma/);
    expect(describeExpected(["<identifier>"])).toMatch(/name/);
  });
  it("splices by UTF-8 byte offset", () => {
    expect(spliceBytes("é x", 3, 0, "y ")).toBe("é y x");
    expect(spliceBytes("a = 1;", 4, 1, "2")).toBe("a = 2;");
  });
  it("finds declared names before an offset, skipping functions", () => {
    const toks = ALL.P03.doc.tokens;
    expect(namesDeclaredBefore(toks, 10_000)).toEqual(expect.arrayContaining(["counter", "n"]));
    expect(namesDeclaredBefore(toks, 10_000)).not.toContain("tick");
  });
  it("has a beginner explanation for every AST node kind the compiler emits", () => {
    for (const k of ["Program", "Function", "Param", "DeclStmt", "VarDecl", "Block", "Assign", "If", "While", "For", "Return", "Break", "Continue", "ExprStmt", "EmptyStmt", "Ident", "IntLit", "FloatLit", "CharLit", "BoolLit", "Unary", "Binary", "Call", "Index", "Empty", "Error"])
      expect(NODE_INFO[k], k).toBeDefined();
    const bin = infoFor({ kind: "Binary", op: "+", children: [], span: { start: { offset: 0, line: 1, column: 1 }, end: { offset: 1, line: 1, column: 2 }, tokens: "0..1" } } as never);
    expect(bin.plain({ kind: "Binary", op: "+", children: [] } as never)).toMatch(/adds/);
  });
});
