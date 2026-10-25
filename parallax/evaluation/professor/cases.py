"""Professor-style test inputs for IntelliFix (hand-written part).

Each case states its expectation BEFORE execution:
  grammar : "in" (valid MiniC), "error" (MiniC with errors), "outside" (not MiniC at all)
  lex     : None | "clean" | substring expected in a lexical error message
  parse   : None | "accept" | "reject" | "reject@L:C"
  status  : set of acceptable decision statuses (None = don't care)
  plan_contains / plan_not_contains : substrings expected (not) in the top plan source
  explain : why this is the right behaviour (used verbatim in the report)

Categories follow the numbering of the evaluation request (1..28).
"""
from __future__ import annotations

R = "RECOMMENDED"
MP = "MULTIPLE_PLAUSIBLE"
LC = "LOW_CONFIDENCE"
NS = "NO_SAFE_REPAIR"
UC = "UNSUPPORTED_CONSTRUCT"
OK = "NO_REPAIR_NEEDED"
ANY_REPAIR = {R, MP, LC, NS}


def M(body: str) -> str:
    """Wraps statements in a main function."""
    return "int main() {\n" + body + "\n}\n"


CASES: list[dict] = [
    # 1 valid complete programs ------------------------------------------------
    dict(id="P01", cat=1, title="valid: max of three", grammar="in", lex="clean", parse="accept", status={OK},
         src="int max3(int a, int b, int c) {\n  int m = a;\n  if (b > m) m = b;\n  if (c > m) m = c;\n  return m;\n}\n",
         explain="A complete, valid MiniC program: no lexical errors, the parser accepts it and no repair is proposed."),
    dict(id="P02", cat=1, title="valid: sum of an array with for-loop", grammar="in", lex="clean", parse="accept", status={OK},
         src="int a[5];\nint sum() {\n  int s = 0;\n  for (int i = 0; i < 5; i = i + 1) {\n    s = s + a[i];\n  }\n  return s;\n}\n",
         explain="Globals, arrays, for-loops with a declaration in the init clause are all part of MiniC."),
    dict(id="P03", cat=1, title="valid: void function and calls", grammar="in", lex="clean", parse="accept", status={OK},
         src="int counter = 0;\nvoid tick(int n) {\n  counter = counter + n;\n}\nint main() {\n  tick(2);\n  tick(3);\n  return counter;\n}\n",
         explain="void functions, call statements and globals parse."),
    dict(id="P04", cat=1, title="valid: float, char and bool", grammar="in", lex="clean", parse="accept", status={OK},
         src="float area(float r) {\n  return 3.14 * r * r;\n}\nint main() {\n  char c = 'x';\n  bool big = area(2.0) > 10.0;\n  return 0;\n}\n",
         explain="All four value types and their literal forms are supported."),
    # 2 standalone statements -------------------------------------------------
    dict(id="P05", cat=2, title="standalone assignment (no function)", grammar="outside", lex="clean", parse="reject@1:1",
         status=ANY_REPAIR, src="x = 5;\n",
         explain="MiniC only allows declarations and functions at top level, so a bare statement is a syntax error at its first token. Any repair is a guess (e.g. inserting a type to make it a declaration)."),
    dict(id="P06", cat=2, title="standalone expression", grammar="outside", lex="clean", parse="reject@1:1",
         status=ANY_REPAIR | {UC}, src="1 + 2 * 3;\n",
         explain="Expressions are only allowed inside function bodies; the parser rejects this at the first token."),
    dict(id="P07", cat=2, title="standalone declaration (valid)", grammar="in", lex="clean", parse="accept", status={OK},
         src="int x = 5;\n",
         explain="A global declaration on its own IS a complete MiniC program."),
    dict(id="P08", cat=2, title="statement without semicolon at top level", grammar="outside", lex="string literals", corrected="first run: expected lex=clean; wrong, because the spec (MINIC_LANGUAGE_SPEC §1) reports unsupported C constructs as UNSUPPORTED lexical tokens", parse="reject",
         status=ANY_REPAIR, src="printf(\"hi\")\n",
         explain="Top-level call plus a string literal (strings are unsupported)."),
    # 3 declarations and assignments ------------------------------------------
    dict(id="P09", cat=3, title="multiple declarators", grammar="in", lex="clean", parse="accept", status={OK},
         src=M("  int a, b = 2, c[3];\n  a = b;\n  c[0] = a;\n  return a;")),
    dict(id="P10", cat=3, title="chained assignment (not MiniC)", grammar="outside", lex="clean", parse="reject",
         status=ANY_REPAIR, src=M("  int a;\n  int b;\n  a = b = 3;\n  return a;"),
         explain="In MiniC assignment is a statement, not an expression, so `a = b = 3` is rejected at the second `=`."),
    dict(id="P11", cat=3, title="assign to an expression", grammar="error", lex="clean", parse="reject", status=ANY_REPAIR,
         src=M("  int a = 1;\n  a + 1 = 2;\n  return a;"),
         explain="Only identifiers and array elements can be assigned."),
    # 4 arithmetic and logical expressions -------------------------------------
    dict(id="P12", cat=4, title="arithmetic and logic", grammar="in", lex="clean", parse="accept", status={OK},
         src=M("  int x = (1 + 2) * 3 % 4 - -5 / 2;\n  bool b = !(x < 3) && x != 0 || x == 7;\n  return x;")),
    # 5 precedence ---------------------------------------------------------------
    dict(id="P13", cat=5, title="precedence: * binds tighter than +", grammar="in", lex="clean", parse="accept", status={OK},
         src=M("  int x = 1 + 2 * 3;\n  return x;"),
         explain="The AST is Binary + (1, Binary * (2, 3)); see the AST explorer."),
    # 6 nested expressions ---------------------------------------------------------
    dict(id="P14", cat=6, title="deeply parenthesised expression", grammar="in", lex="clean", parse="accept", status={OK},
         src=M("  int x = ((((((1 + 2)) * ((3 - 4))))) / (5));\n  return x;")),
    # 7 conditionals ----------------------------------------------------------------
    dict(id="P15", cat=7, title="if / else if / else chain", grammar="in", lex="clean", parse="accept", status={OK},
         src=M("  int g = 70;\n  if (g > 90) {\n    return 1;\n  } else if (g > 60) {\n    return 2;\n  } else {\n    return 3;\n  }")),
    dict(id="P16", cat=7, title="dangling else", grammar="in", lex="clean", parse="accept", status={OK},
         src=M("  int x = 0;\n  if (x > 0) if (x > 5) x = 1; else x = 2;\n  return x;"),
         explain="Accepted: `else` binds to the nearest `if` (one documented precedence declaration)."),
    # 8 loops ----------------------------------------------------------------------
    dict(id="P17", cat=8, title="while, for, break, continue", grammar="in", lex="clean", parse="accept", status={OK},
         src=M("  int i = 0;\n  while (true) {\n    i = i + 1;\n    if (i > 3) break;\n  }\n  for (;;) { continue; }\n  return i;")),
    dict(id="P18", cat=8, title="do-while loop (unsupported)", grammar="outside", lex="'do' is a C keyword", corrected="first run: expected lex=clean; wrong, because the spec (MINIC_LANGUAGE_SPEC §1) reports unsupported C constructs as UNSUPPORTED lexical tokens", status={UC},
         src=M("  int i = 0;\n  do { i = i + 1; } while (i < 3);\n  return i;"),
         explain="`do` is a C keyword that MiniC deliberately omits; IntelliFix says so instead of inventing a repair."),
    # 9 functions ------------------------------------------------------------------
    dict(id="P19", cat=9, title="recursive function", grammar="in", lex="clean", parse="accept", status={OK},
         src="int fact(int n) {\n  if (n <= 1) return 1;\n  return n * fact(n - 1);\n}\n"),
    dict(id="P20", cat=9, title="function prototype (unsupported)", grammar="outside", lex="clean", parse="reject",
         status=ANY_REPAIR, src="int f(int a);\nint f(int a) { return a; }\n",
         explain="MiniC has no prototypes (a function needs a body); the parser rejects the `;` after the parameter list."),
    dict(id="P21", cat=9, title="call with wrong number of arguments", grammar="in", lex="clean", parse="accept", status={OK},
         src="int add(int a, int b) { return a + b; }\nint main() { return add(1); }\n",
         explain="Syntactically valid: arity is not a syntax rule. The AST explorer lists an arity warning from name resolution; it is not a syntax error."),
    # 10 missing semicolons --------------------------------------------------------
    dict(id="P22", cat=10, title="missing semicolon after declaration", grammar="error", lex="clean", parse="reject@3:3",
         status={R}, plan_contains="int count = 10;", src=M("  int count = 10\n  count = count - 1;\n  return count;"),
         explain="Detected at the next line; the repair inserts `;` at the end of line 2 (line-end evidence)."),
    dict(id="P23", cat=10, title="missing semicolon after return", grammar="error", lex="clean", parse="reject",
         status={R}, plan_contains="return 0;", src=M("  return 0\n"),
         explain="The `}` cannot follow `return 0`; inserting `;` is the only cheap repair."),
    dict(id="P24", cat=10, title="missing semicolon after a call", grammar="error", lex="clean", parse="reject",
         status={R, MP}, plan_contains="f(1);", src="void f(int x) { }\nint main() {\n  f(1)\n  return 0;\n}\n"),
    # 11 extra semicolons ------------------------------------------------------------
    dict(id="P25", cat=11, title="extra semicolon inside a block is legal", grammar="in", lex="clean", parse="accept",
         status={OK}, src=M("  int x = 1;;\n  return x;"),
         explain="`;;` is valid C and MiniC (an empty statement), so there is nothing to repair."),
    dict(id="P26", cat=11, title="semicolon after a function body", grammar="error", lex="clean", parse="reject",
         status={R, MP}, plan_not_contains="};", src="int main() {\n  return 0;\n};\n",
         explain="An empty declaration at top level is not allowed in MiniC; deleting the `;` repairs it."),
    dict(id="P27", cat=11, title="semicolon inside if condition", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR, src=M("  int x = 1;\n  if (x > 0;) x = 2;\n  return x;")),
    # 12 parentheses -------------------------------------------------------------------
    dict(id="P28", cat=12, title="missing closing parenthesis in if", grammar="error", lex="clean", parse="reject",
         status={R}, plan_contains="if (n > 0) {", src=M("  int n = 3;\n  if (n > 0 {\n    n = 0;\n  }\n  return n;")),
    dict(id="P29", cat=12, title="missing opening parenthesis in while", grammar="error", lex="clean", parse="reject",
         status={R, MP}, plan_contains="while (n > 0)", src=M("  int n = 3;\n  while n > 0) {\n    n = n - 1;\n  }\n  return n;")),
    dict(id="P30", cat=12, title="extra closing parenthesis", grammar="error", lex="clean", parse="reject",
         status={R, MP}, plan_contains="(1 + 2) * 3;", src=M("  int x = (1 + 2)) * 3;\n  return x;")),
    dict(id="P31", cat=12, title="missing parenthesis in call", grammar="error", lex="clean", parse="reject",
         status={R, MP, LC}, src="int g(int a) { return a; }\nint main() {\n  return g(4;\n}\n"),
    # 13 braces ----------------------------------------------------------------------------
    dict(id="P32", cat=13, title="missing closing brace at end of file", grammar="error", lex="clean", parse="reject",
         status={R}, src="int main() {\n  int x = 1;\n  return x;\n"),
    dict(id="P33", cat=13, title="missing closing brace of an inner block", grammar="error", lex="clean", parse="reject",
         status={R, MP}, src="int main() {\n  int x = 0;\n  while (x < 3) {\n    x = x + 1;\n  return x;\n}\n",
         explain="The error is only detected at end of input; indentation evidence places the `}` before `return`."),
    dict(id="P34", cat=13, title="extra closing brace", grammar="error", lex="clean", parse="reject",
         status={R, MP}, src="int main() {\n  return 0;\n}\n}\n"),
    dict(id="P35", cat=13, title="missing opening brace of a loop body", grammar="error", lex="clean", parse="reject",
         status={R, MP}, src="int main() {\n  int i = 0;\n  int s = 0;\n  while (i < 4)\n    s = s + i;\n    i = i + 1;\n  }\n  return s;\n}\n"),
    # 14 missing identifiers and operands ---------------------------------------------------
    dict(id="P36", cat=14, title="missing variable name", grammar="error", lex="clean", parse="reject",
         status={LC}, src=M("  int = 4;\n  return 0;"),
         explain="Any repair must invent a name; IntelliFix inserts the placeholder `__hole` and reports LOW_CONFIDENCE."),
    dict(id="P37", cat=14, title="missing right operand", grammar="error", lex="clean", parse="reject",
         status={MP, LC}, src=M("  int x = 4 * ;\n  return x;")),
    dict(id="P38", cat=14, title="missing left operand", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR, src=M("  int x = * 4;\n  return x;")),
    dict(id="P39", cat=14, title="missing operator between operands", grammar="error", lex="clean", parse="reject",
         status={MP}, src=M("  int a = 2;\n  int b = 3;\n  int c = a b;\n  return c;"),
         explain="Fourteen different operators would all parse; the margin between distinct ASTs is 0, so IntelliFix lists alternatives."),
    # 15 misspelled keywords --------------------------------------------------------------
    dict(id="P40", cat=15, title="misspelled return", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR, src=M("  retrun 0;"),
         explain="`retrun` is an ordinary identifier to the lexer, so the parser sees `identifier literal` and rejects at `0`. The cheap repairs (e.g. insert `=`) parse but do not restore `return`: a known limitation."),
    dict(id="P41", weakness="confident but unintended repair: the result is a valid call to an undeclared function `whlie`", cat=15, title="misspelled while", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR, src=M("  int i = 0;\n  whlie (i < 3) {\n    i = i + 1;\n  }\n  return i;"),
         explain="`whlie (i < 3)` parses as a call; the error appears at `{`. A cheap valid repair exists (insert `;`), which changes the meaning: this is an important limitation to explain."),
    dict(id="P42", cat=15, title="misspelled type", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR, src=M("  itn x = 1;\n  return x;")),
    # 16 invalid characters and punctuation ---------------------------------------------------
    dict(id="P43", cat=16, title="invalid character @", grammar="error", lex="invalid character '@'", parse="reject",
         status={MP, R}, src=M("  int x = 5 @ 2;\n  return x;")),
    dict(id="P44", cat=16, title="dollar in identifier", grammar="error", lex="invalid character '$'", parse="reject",
         status=ANY_REPAIR, src=M("  int $x = 1;\n  return 0;")),
    dict(id="P45", cat=16, title="colon instead of semicolon", grammar="error", lex=None, parse="reject",
         status={UC, R, MP}, src=M("  int x = 1:\n  return x;"),
         explain="`:` is recognised as an unsupported C operator token; IntelliFix reports UNSUPPORTED_CONSTRUCT rather than silently replacing it."),
    dict(id="P46", cat=16, title="backtick", grammar="error", lex="invalid character '`'", parse="reject",
         status=ANY_REPAIR, src=M("  int x = 1`;\n  return x;")),
    # 17 multiple errors -----------------------------------------------------------------------
    dict(id="P47", cat=17, title="two errors: missing ; and missing )", grammar="error", lex="clean", parse="reject",
         status={R}, plan_contains="if (s > 10) {",
         src="int f(int a, int b) {\n  int s = a + b\n  if (s > 10 {\n    s = 10;\n  }\n  return s;\n}\n"),
    dict(id="P48", cat=17, title="three errors in one function", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR | {"BUDGET_EXHAUSTED"},
         src="int main() {\n  int a = 1\n  int b = (a + 2;\n  if (b > a {\n    a = b;\n  }\n  return a;\n}\n",
         explain="Three independent errors: hypothesis lanes repair them one at a time (depth limit 4)."),
    dict(id="P49", cat=17, title="errors in two functions", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR, src="int f() {\n  return 1\n}\nint g() {\n  return (2;\n}\n"),
    # 18 incomplete source at EOF ---------------------------------------------------------------
    dict(id="P50", cat=18, title="file ends inside a function", grammar="error", lex="clean", parse="reject",
         status={R, MP}, src="int main() {\n  int x = 1;\n"),
    dict(id="P51", cat=18, title="file ends inside a condition", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR, src="int main() {\n  if (x > \n"),
    dict(id="P52", cat=18, title="file ends after a type", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR, src="int"),
    # 19 empty / whitespace ---------------------------------------------------------------------
    dict(id="P53", cat=19, title="empty input", grammar="in", lex="clean", parse="accept", status={OK}, src="",
         explain="An empty file is a valid (empty) MiniC program."),
    dict(id="P54", cat=19, title="whitespace and newlines only", grammar="in", lex="clean", parse="accept", status={OK},
         src="   \n\t\n\r\n   \n"),
    dict(id="P55", cat=19, title="comments only", grammar="in", lex="clean", parse="accept", status={OK},
         src="// nothing here\n/* still\n   nothing */\n"),
    # 20 deep nesting ---------------------------------------------------------------------------
    dict(id="P56", cat=20, title="20 nested if-blocks", grammar="in", lex="clean", parse="accept", status={OK},
         src="int main() {\n  int x = 1;\n" + "".join("  " * (i + 1) + "if (x > 0) {\n" for i in range(20))
             + "".join("  " * (20 - i) + "}\n" for i in range(20)) + "  return x;\n}\n"),
    dict(id="P57", cat=20, title="400 nested parentheses", grammar="in", lex="clean", parse="accept", status={OK},
         src="int main() { return " + "(" * 400 + "1" + ")" * 400 + "; }\n"),
    dict(id="P58", cat=20, title="6000 nested parentheses (beyond the limit)", grammar="in", lex="clean", parse="reject",
         corrected="updated after the P86 fix: a parser-stack overflow is now reported as UNSUPPORTED_CONSTRUCT instead of being searched",
         status={UC}, src="int main() { return " + "(" * 6000 + "1" + ")" * 6000 + "; }\n",
         explain="Exceeds the parser's documented 5000-entry stack: reported as a resource limit, never a crash."),
    # 21 ambiguous repairs --------------------------------------------------------------------
    dict(id="P59", cat=21, title="ambiguous: comparison or assignment?", grammar="error", lex="clean", parse="reject",
         status={MP, R}, src=M("  int x = 1;\n  int y = 2;\n  if (x y) x = 0;\n  return x;")),
    dict(id="P60", cat=21, title="ambiguous: lexical @ between operands", grammar="error", lex="invalid character '@'",
         parse="reject", status={MP}, src=M("  int x = 6 @ 3;\n  return x;")),
    # 22 valid code unchanged ------------------------------------------------------------------
    dict(id="P61", cat=22, title="valid program with unusual formatting", grammar="in", lex="clean", parse="accept",
         status={OK}, src="int\nmain\n(\n)\n{\nreturn\n0\n;\n}\n",
         explain="Whitespace and line breaks never matter to the grammar."),
    # 23 cheap repair changes meaning ------------------------------------------------------------
    dict(id="P62", weakness="confident but unintended repair: the loop becomes an expression statement plus a block", cat=23, title="deleted `while` keyword", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR, src=M("  int n = 5;\n  (n > 0) {\n    n = n - 1;\n  }\n  return n;"),
         explain="Inserting `;` gives `(n > 0); { … }`: valid, but no longer a loop. Parser acceptance does not prove intent."),
    dict(id="P63", cat=23, title="`=` written for `==` in a condition", grammar="error", lex="clean", parse="reject",
         status={R, MP}, src=M("  int x = 3;\n  if (x = 3) x = 0;\n  return x;"),
         explain="Assignment is not an expression in MiniC, so this is a syntax error here (unlike C)."),
    # 24 unsupported C/C++ ----------------------------------------------------------------------
    dict(id="P64", cat=24, title="#include and printf with a string", grammar="outside", lex=None, status={UC},
         src="#include <stdio.h>\nint main() {\n  printf(\"hello\");\n  return 0;\n}\n",
         explain="Preprocessor lines and strings are recognised C constructs that MiniC omits; reported as unsupported."),
    dict(id="P65", cat=24, title="increment operator", grammar="outside", lex=None, status={UC},
         src=M("  int i = 0;\n  i++;\n  return i;")),
    dict(id="P66", cat=24, title="compound assignment", grammar="outside", lex=None, status={UC},
         src=M("  int i = 0;\n  i += 2;\n  return i;")),
    dict(id="P67", cat=24, title="struct", grammar="outside", lex=None, status={UC},
         src="struct point { int x; };\n"),
    dict(id="P68", cat=24, title="pointer declaration", grammar="outside", lex="clean", parse="reject",
         status=ANY_REPAIR, src=M("  int *p;\n  return 0;"),
         explain="`*` is a valid MiniC operator, so `int *p` is lexed fine but cannot be parsed: pointers are not part of the grammar. A repair here would only be a syntactic guess."),
    dict(id="P69", cat=24, title="C++ class and namespace", grammar="outside", lex="operator ':'", corrected="first run: expected lex=clean; wrong, because the spec (MINIC_LANGUAGE_SPEC §1) reports unsupported C constructs as UNSUPPORTED lexical tokens", parse="reject",
         status=ANY_REPAIR, src="class A { public: int x; };\n",
         explain="`class` and `public` are plain identifiers in MiniC; `:` is an unsupported operator token; the parser rejects at the first token."),
    dict(id="P70", cat=24, title="ternary operator", grammar="outside", lex=None, status={UC},
         src=M("  int x = 1;\n  int y = x > 0 ? 1 : 2;\n  return y;")),
    dict(id="P71", cat=24, title="switch statement", grammar="outside", lex=None, status={UC},
         src=M("  int x = 1;\n  switch (x) { }\n  return x;")),
    # 25 comments, strings, numbers ---------------------------------------------------------------
    dict(id="P72", cat=25, title="comments everywhere", grammar="in", lex="clean", parse="accept", status={OK},
         src="/* head */ int /* a */ main(/* b */) { // c\n  return /* d */ 0; /* e */ }\n"),
    dict(id="P73", cat=25, title="unterminated block comment", grammar="error", lex="unterminated block comment",
         parse="reject", status=ANY_REPAIR - {R},
         corrected="tightened after review: the first run PASSED with RECOMMENDED \"replace '/*' with '}'\", which silently discards the "
                   "code inside the comment; that was a defect, now fixed (such plans are capped at LOW_CONFIDENCE)",
         src="int main() { /* forgot to close\n return 0; }\n"),
    dict(id="P74", cat=25, title="number formats", grammar="in", lex="clean", parse="accept", status={OK},
         src=M("  float a = 1.5e3;\n  float b = 2.0E-2;\n  int c = 007;\n  return c;")),
    dict(id="P75", cat=25, title="malformed number", grammar="error", lex="digits immediately followed by letters",
         parse="reject", status=ANY_REPAIR, src=M("  int x = 12abc;\n  return x;")),
    dict(id="P76", cat=25, title="integer overflow literal", grammar="error", lex="out of range", parse="reject",
         status=ANY_REPAIR, src=M("  int x = 99999999999;\n  return x;")),
    dict(id="P77", cat=25, title="char escapes", grammar="in", lex="clean", parse="accept", status={OK},
         src=M("  char a = '\\n';\n  char b = '\\'';\n  char c = '\\\\';\n  return 0;")),
    dict(id="P78", cat=25, title="Unicode inside a comment", grammar="in", lex="clean", parse="accept", status={OK},
         src="// καλημέρα — 你好 — 😀\nint main() { return 0; }\n"),
    dict(id="P79", cat=25, title="Unicode outside a comment", grammar="error", lex="non-ASCII", parse="reject",
         status=ANY_REPAIR, src="int main() { int café = 1; return 0; }\n"),
    # 26 long or malformed -------------------------------------------------------------------------
    dict(id="P80", cat=26, title="long valid program (300 statements)", grammar="in", lex="clean", parse="accept",
         status={OK}, src=M("  int x = 0;\n" + "".join(f"  x = x + {i};\n" for i in range(300)) + "  return x;")),
    dict(id="P81", cat=26, title="random punctuation soup", grammar="outside", lex="clean", parse="reject",
         status=ANY_REPAIR | {"BUDGET_EXHAUSTED"}, src="}{)(;;,]{[}=+*)(\n"),
    dict(id="P82", cat=26, title="binary-looking bytes", grammar="outside", lex="invalid", parse="reject",
         status=ANY_REPAIR | {"BUDGET_EXHAUSTED"}, src="\x01\x02\x7fint\x00main"),
    # added after the first run: inputs a professor might paste, plus one regression
    dict(id="P83", cat=25, title="smart quotes pasted from a word processor", grammar="error", lex="non-ASCII",
         parse="reject", status=ANY_REPAIR, src="int main() { char c = \u2018a\u2019; return 0; }\n",
         explain="Typographic quotes are not ASCII apostrophes; the lexer flags each one with its exact position."),
    dict(id="P84", cat=26, title="NUL byte inside the program", grammar="error", lex="control character",
         parse="reject", status=ANY_REPAIR, src="int main() { return 0;\x00 }\n"),
    dict(id="P85", cat=26, title="UTF-8 byte-order mark at the start", grammar="error", lex="non-ASCII",
         parse="reject", status=ANY_REPAIR, src="\ufeffint main() { return 0; }\n",
         explain="Some Windows editors add a BOM; MiniC is ASCII, so it is reported rather than silently skipped."),
    dict(id="P86", cat=26, title="valid program nested 3000 blocks deep", grammar="in", lex="clean", parse="reject",
         status={UC}, src="int main() " + "{" * 3000 + "}" * 3000,
         explain="Valid MiniC, but deeper than the parser stack allows. Regression: before the fix the engine searched "
                 "for 3.5 s and proposed brace deletions that did not parse; it now reports the capacity limit."),
    dict(id="P87", cat=26, title="3000 nested parentheses", grammar="in", lex="clean", parse="accept", status={OK},
         src="int main() { return " + "(" * 3000 + "1" + ")" * 3000 + "; }",
         explain="Expressions nest further than blocks before the parser stack limit is reached."),
    dict(id="P88", cat=26, title="300 consecutive broken declarations", grammar="error", lex="clean", parse="reject",
         status=ANY_REPAIR | {"BUDGET_EXHAUSTED"}, src="int main() {\n" + "  int x = \n" * 300 + "}",
         explain="Many interacting errors: IntelliFix fixes what it can in its bounded search and does not claim certainty."),
]

# 27/28 and the HTTP-level checks (oversized input, repeated requests,
# valid-after-invalid, concurrency) are sequences, defined in run_professor_tests.py.
