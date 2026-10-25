import { inlineChange, lineDiff } from "../../src/lib/diff";
import { rulesFor } from "../../src/lib/lexerRules";
import { OffsetMap } from "../../src/lib/positions";

describe("OffsetMap (UTF-8 bytes -> UTF-16 indices)", () => {
  it("is the identity for ASCII", () => {
    const m = new OffsetMap("int x;");
    expect(m.toUtf16(4)).toBe(4);
    expect(m.toUtf16(6)).toBe(6);
  });
  it("accounts for multi-byte characters in comments", () => {
    const src = "/* é */ x"; // é is 2 bytes, 1 UTF-16 unit
    const m = new OffsetMap(src);
    expect(m.toUtf16(9)).toBe(8);
    expect(src[m.toUtf16(9)]).toBe("x");
  });
  it("handles astral characters (4 bytes, 2 UTF-16 units)", () => {
    const src = "// 😀\ny";
    const m = new OffsetMap(src);
    const byteOfY = new TextEncoder().encode("// 😀\n").length;
    expect(src[m.toUtf16(byteOfY)]).toBe("y");
  });
  it("clamps out-of-range offsets", () => {
    const m = new OffsetMap("ab");
    expect(m.toUtf16(-3)).toBe(0);
    expect(m.toUtf16(99)).toBe(2);
  });
});

describe("lineDiff", () => {
  it("marks inserted and deleted lines", () => {
    const d = lineDiff("a\nb\nc", "a\nB\nc");
    expect(d.map((l) => l.kind)).toEqual(["same", "del", "add", "same"]);
  });
  it("reports no change for identical text", () => {
    expect(lineDiff("x\ny", "x\ny").every((l) => l.kind === "same")).toBe(true);
  });
  it("finds the changed span inside a line", () => {
    const c = inlineChange("int x = 1", "int x = 1;");
    expect(c.prefix).toBe(9);
    expect("int x = 1;".slice(c.prefix, c.suffixB)).toBe(";");
  });
});

describe("rulesFor", () => {
  const lexer = `"int"                { EMIT(TokenKind::KwInt); }\n"="                  { EMIT(TokenKind::Assign); }\n.                    {\n                       EMIT_MSG(TokenKind::Error, "x");\n                     }`;
  it("finds the Flex rule that emits a kind", () => {
    expect(rulesFor(lexer, "INT")[0]).toContain('"int"');
    expect(rulesFor(lexer, "ASSIGN")[0]).toContain('"="');
  });
  it("includes the pattern line of multi-line actions", () => {
    expect(rulesFor(lexer, "ERROR")[0].startsWith(".")).toBe(true);
  });
  it("returns nothing for unknown kinds", () => {
    expect(rulesFor(lexer, "NOPE")).toEqual([]);
  });
});

import { rewriteDocLinks } from "../../src/components/Markdown";
describe("rewriteDocLinks", () => {
  it("maps sibling Markdown docs to in-app routes", () => {
    expect(rewriteDocLinks('<a href="docs/TESTING.md">t</a>')).toContain('href="/docs/TESTING"');
    expect(rewriteDocLinks('<a href="RESULTS_AND_IMPACT.md#x">r</a>')).toContain('href="/docs/RESULTS_AND_IMPACT"');
    expect(rewriteDocLinks('<a href="../README.md">r</a>')).toContain('href="/docs/README"');
    expect(rewriteDocLinks('<a href="https://example.org/a.md">x</a>')).toContain("https://example.org/a.md");
    expect(rewriteDocLinks('<a href="evaluation/results/report.md">r</a>')).toContain('class="repo-path"');
    expect(rewriteDocLinks('<a href="IntelliFix_Glossary.md">g</a>')).toContain('href="/docs/IntelliFix_Glossary"');
  });
  it("serves doc images through the API", () => {
    expect(rewriteDocLinks('<img src="images/walkthrough/05-a.png" alt="x">')).toContain('src="/api/docs/images/walkthrough/05-a.png"');
    expect(rewriteDocLinks('<a href="images/walkthrough/05-a.png">05</a>')).toContain('href="/api/docs/images/walkthrough/05-a.png"');
    expect(rewriteDocLinks('<img src="images/../secret.png">')).not.toContain("/api/docs/images/../");
  });
});
