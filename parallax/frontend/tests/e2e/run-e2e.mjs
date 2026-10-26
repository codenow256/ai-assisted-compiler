// End-to-end test: real compiler + FastAPI backend + built UI in Chromium.
// Usage: start the backend (it serves frontend/dist), then
//   PARALLAX_URL=http://localhost:8000 node tests/e2e/run-e2e.mjs
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const BASE = process.env.PARALLAX_URL ?? "http://localhost:8000";
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(["PASS", name]);
  } catch (e) {
    results.push(["FAIL", name, String(e).split("\n")[0]]);
  }
}
const expect = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
const T = { timeout: 15000 };

const editor = () => page.locator(".ws-editor .cm-content").innerText();
// The app saves the editor draft after a short debounce, so a pending save from the previous page
// can overwrite the draft written here: retry until the editor really shows `src`.
const loadDraft = async (src) => {
  for (let i = 0; i < 4; i++) {
    await page.goto(`${BASE}/research`);
    await page.waitForTimeout(500);
    await page.evaluate((s) => localStorage.setItem("parallax-draft", JSON.stringify({ source: s, origin: { kind: "user", label: "e2e.mc" } })), src);
    await page.goto(`${BASE}/`);
    await page.locator(".cm-content").first().waitFor();
    const got = await page.evaluate(() => JSON.parse(localStorage.getItem("parallax-draft") ?? "{}").source);
    if (got === src) return;
  }
  throw new Error("could not load the draft");
};
const analyze = async () => {
  await page.getByTestId("analyze").click();
  await page.getByTestId("explanation").waitFor(T);
};
const stepBtn = (name) => page.locator(".stepper").getByRole("button", { name: new RegExp("^" + name) });
const nav = (name) => page.getByRole("complementary", { name: "Primary" }).getByRole("link", { name: new RegExp("^" + name) });

await step("workspace loads samples from the backend; exactly three primary destinations", async () => {
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => document.querySelectorAll("#sample option").length > 5, null, T);
  const n = await page.getByRole("complementary", { name: "Primary" }).getByRole("link").count();
  expect(n === 3, `expected 3 nav links, got ${n}`);
});

await step("missing semicolon: diagnose → recommended fix → tree → apply → verified → undo", async () => {
  await page.selectOption("#sample", "02_missing_semicolon");
  await analyze();
  const ex = await page.getByTestId("explanation").innerText();
  expect(/Missing delimiter/.test(ex), "category missing");
  expect(/Line 4: the parser did not expect the type keyword int/.test(ex), "headline missing");
  expect(/previous line \(3\) is missing its ;/.test(ex), "missing-semicolon reasoning missing");
  await page.getByRole("button", { name: /Compare fixes/ }).click();
  await page.getByTestId("recommended").getByText(/Insert ; at 3:16/).waitFor();
  await page.getByTestId("recommended").getByRole("button", { name: /Use this fix/ }).click();
  await page.getByText(/How your chosen fix/).waitFor();
  await page.getByText(/Partial tree → complete tree/).waitFor(T);
  await page.getByRole("button", { name: "Apply & verify", exact: true }).click();
  await page.getByTestId("apply").click();
  await page.getByText(/Verified: every check IntelliFix performs passes/).waitFor(T);
  expect((await editor()).includes("int total = 0;"), "editor not updated");
  await page.getByTestId("verify").getByRole("button", { name: /Undo repair/ }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("1 repair applied"));
  expect(!(await editor()).includes("int total = 0;"), "undo failed");
});

await step("a page refresh keeps the editor draft", async () => {
  await page.waitForTimeout(600);
  await page.reload();
  await page.locator(".cm-content").first().waitFor();
  expect((await editor()).includes("int total = 0"), "draft lost on refresh");
});

await step("ambiguity: targeted question → own fill-in validated by the parser → tree → apply → verified", async () => {
  await loadDraft("int main() {\n  int price = 5;\n  int total = price + ;\n  return total;\n}\n");
  await analyze();
  await stepBtn("Fixes").click();
  const q = page.getByTestId("clarify");
  await q.getByText("Is the + extra, or is something missing after it?").waitFor();
  expect(await q.getByRole("button", { name: /Use this answer/ }).isDisabled(), "usable before validation");
  await q.getByText("Fill in the missing value or expression yourself").click();
  await q.getByRole("button", { name: "price", exact: true }).click();
  await q.getByRole("button", { name: "Check with the parser" }).click();
  await q.getByText("Valid MiniC").waitFor(T);
  await q.getByRole("button", { name: /Use this answer/ }).click();
  await page.getByText(/the parser skipped/).waitFor(T);
  await page.getByRole("button", { name: "Apply & verify", exact: true }).click();
  await page.getByTestId("apply").click();
  await page.getByText(/Verified/).waitFor(T);
  expect((await editor()).includes("price + price"), "fill-in not applied");
});

await step("ambiguity: missing operator asks which operator, options are real plans", async () => {
  await loadDraft("int main() {\n  int a = 1;\n  int b = 2;\n  int c = a b;\n  return c;\n}\n");
  await analyze();
  await stepBtn("Fixes").click();
  const q = page.getByTestId("clarify");
  await q.getByText("Which operator did you mean between a and b?").waitFor();
  await q.getByText("Insert - at 4:12").click();
  await q.getByRole("button", { name: "Check with the parser" }).click();
  await q.getByText("Valid MiniC").waitFor(T);
  expect((await page.getByTestId("fix-card").count()) >= 3, "comparison cards missing");
});

await step("progressive hints, then the student's own fix is checked by the compiler", async () => {
  await loadDraft("int main() {\n  int x = 1\n  return x;\n}\n");
  await analyze();
  await page.getByRole("button", { name: /Show a hint/ }).click();
  await page.getByText(/Look at line 3/).waitFor();
  await page.getByRole("button", { name: /try it in the editor/ }).click();
  await page.locator(".ws-editor .cm-line").nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.type(";");
  await page.getByRole("button", { name: "Check my fix" }).click();
  await page.getByText("Your fix works: the program now parses.").waitFor(T);
});

await step("two errors: first error vs later reports; the plan fixes both and verification shows what disappeared", async () => {
  await loadDraft("int main() {\n  int x = 1\n  if (x > 0 {\n    x = 2;\n  }\n  return x;\n}\n");
  await analyze();
  await page.getByText(/3 error reports — which one matters\?/).waitFor();
  await page.getByText("first error (reliable)").waitFor();
  await page.getByRole("button", { name: /Compare fixes/ }).click();
  await page.getByTestId("recommended").getByRole("button", { name: /Use this fix/ }).click();
  await page.getByRole("button", { name: "Apply & verify", exact: true }).click();
  await page.getByTestId("apply").click();
  await page.getByText(/Verified/).waitFor(T);
  await page.getByText("No longer reported (3)").waitFor();
});

await step("every other input category gets an honest, specific response", async () => {
  const cases = [
    ["", /no program to analyze/],
    ["   \n\n  ", /Only whitespace/],
    ["int main() {\n  int x = 1;\n  /* never ends\n  return x;\n}\n", /comment that starts on line 3 never ends/],
    ["int main() {\n  int i = 0;\n  i++;\n  return i;\n}\n", /This is C, not MiniC/],
    ["int main() {\n  int x = 1 @ 2;\n  return x;\n}\n", /Invalid characters|not part of MiniC/],
    ["int main() {\n  int x = 1;\n", /The file ends before the program is complete/],
    ["hello world this is not code", /No safe repair/],
    ["int main() { return " + "(".repeat(6000) + "1" + ")".repeat(6000) + "; }\n", /nests deeper than the parser can handle/],
  ];
  for (const [src, re] of cases) {
    await loadDraft(src);
    await analyze();
    const t = await page.getByTestId("explanation").innerText();
    expect(re.test(t), `no match for ${re} on ${JSON.stringify(src.slice(0, 30))}: ${t.slice(0, 120)}`);
    await stepBtn("Fixes").click();
    expect((await page.locator(".ws-step").innerText()).length > 80, "fixes step empty");
  }
  await loadDraft("");
  await analyze();
  await page.getByRole("button", { name: "Load a sample program" }).click();
  expect((await editor()).length > 10, "sample not loaded");
});

await step("AST Explorer: node details, grammar rule, absorbed tokens, expression diagram, source → node", async () => {
  await loadDraft("int f(int a, int b, int c) {\n  return a + b * c;\n}\n");
  await nav("AST Explorer").click();
  await page.locator(".outline .ocell").first().waitFor(T);
  await page.locator(".ocell").filter({ hasText: /Binary\s*\+/ }).first().click();
  const card = page.getByTestId("node-card");
  await card.getByText("add_expr → add_expr '+' mul_expr").waitFor();
  await card.getByText(/binds tighter than/).waitFor();
  expect((await card.locator("svg.expr-diagram .dnode").count()) === 5, "expression diagram");
  // click the `;` in the source: the Return node absorbed it
  const semi = await page.evaluate(() => {
    const line = document.querySelectorAll(".ast-grid .cm-line")[1];
    const w = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.textContent.indexOf(";");
      if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 1); const b = r.getBoundingClientRect(); return { x: b.x + 1, y: b.y + b.height / 2 }; }
    }
    return null;
  });
  await page.mouse.click(semi.x, semi.y); // just before the `;`
  await card.locator("h3").filter({ hasText: /^Return/ }).waitFor();
  await page.getByPlaceholder(/Find:/).fill("b");
  expect((await page.locator(".orow.hit").count()) >= 1, "search did not mark nodes");
});

await step("AST Explorer: invalid code shows a labelled partial tree and the repaired program's tree", async () => {
  await loadDraft("int main() {\n  int a = 1;\n  int b = (a + 2;\n  return b;\n}\n");
  await analyze();
  await nav("AST Explorer").click();
  await page.getByText("Partial tree: your code has syntax errors").waitFor(T);
  await page.getByRole("button", { name: "After the fix" }).click();
  await page.getByText(/This is the tree of the repaired program/).waitFor();
});

await step("AST Explorer: before & after of two real repairs", async () => {
  await nav("Workspace").click();
  await page.selectOption("#sample", "07_ambiguous_operator");
  await analyze();
  await nav("AST Explorer").click();
  await page.getByRole("tab", { name: /Before/ }).click();
  await page.getByText(/1 structural change/).waitFor(T);
});

await step("Research & Method: stored numbers, honest labels, full data behind a link", async () => {
  await nav("Research & Method").click();
  await page.getByText(/Research question\./).waitFor(T);
  const t = await page.locator(".research").innerText();
  for (const s of ["71.5%", "55.2%", "6.1%", "28.5%", "50.7%", "Simulation, not a user study", "synthetic"]) expect(t.includes(s), `missing ${s}`);
  await page.getByRole("link", { name: /All results/ }).click();
  await page.getByText("What the experiment shows").waitFor(T);
  await page.getByRole("banner").getByRole("link", { name: /Research & Method/ }).click();
  await page.getByText(/Research question\./).waitFor();
});

await step("specialist views are reached from the Workspace (token table, parser state)", async () => {
  await nav("Workspace").click();
  await page.selectOption("#sample", "02_missing_semicolon");
  await analyze();
  await page.getByText(/Compiler internals: tokens/).click();
  await page.getByRole("link", { name: "Token table" }).click();
  await page.getByRole("button", { name: /Run lexer/ }).first().click();
  await page.locator("tbody tr").nth(3).click();
  await page.getByText("Flex rule(s) that emit this kind").waitFor();
  await page.getByRole("banner").getByRole("link", { name: /Workspace/ }).click();
  await page.getByTestId("analyze").waitFor();
});

await step("sequential correction: several errors fixed one at a time until every check passes (no `++` deletion)", async () => {
  await loadDraft("int main() {\n  int price = 5\n  int total = price + ;\n  total++;\n  return total\n}\n");
  await analyze();
  const applyAndNext = async () => {
    await page.getByRole("button", { name: "Apply & verify", exact: true }).click();
    await page.getByTestId("apply").click();
    await Promise.race([page.getByTestId("next-error").waitFor(T), page.getByTestId("completion").waitFor(T)]);
  };
  // 1: missing ; (recommended, punctuation only)
  await stepBtn("Fixes").click();
  await page.getByTestId("recommended").getByText(/Insert ; at 2:16/).waitFor();
  await page.getByTestId("recommended").getByRole("button", { name: /Use this fix/ }).click();
  await applyAndNext();
  await page.getByTestId("next-error-btn").click();
  // 2: `price + ;` is ambiguous: answer the question with a value, validated by the parser
  const q = page.getByTestId("clarify");
  await q.getByText("Is the + extra, or is something missing after it?").waitFor(T);
  await q.getByText("Fill in the missing value or expression yourself").click();
  await q.getByRole("button", { name: "price", exact: true }).click();
  await q.getByRole("button", { name: "Check with the parser" }).click();
  await q.getByText("This error is fixed; later errors remain").waitFor(T);
  await q.getByRole("button", { name: /Use this answer/ }).click();
  await applyAndNext();
  await page.getByTestId("next-error-btn").click();
  // 3: `total++;` gets a supported rewrite, not a deletion
  const rw = page.getByTestId("rewrite");
  await rw.locator(".line-change .now").getByText("total = total + 1;").waitFor(T);
  await rw.getByRole("button", { name: "Check with the parser" }).click();
  await rw.locator(".banner").waitFor(T);
  await rw.getByRole("button", { name: /Use this rewrite/ }).click();
  await applyAndNext();
  await page.getByTestId("next-error-btn").click();
  // 4: last missing ;
  await page.getByTestId("recommended").getByRole("button", { name: /Use this fix/ }).click();
  await applyAndNext();
  await page.getByTestId("completion").getByText(/Corrections made \(4\)/).waitFor();
  const src = await editor();
  expect(src.includes("price + price") && src.includes("total = total + 1;") && src.includes("return total;"), "intended operations lost: " + src);
});

await step("undeclared name: syntax OK but not reported as success", async () => {
  await loadDraft("int main() {\n  int price = 5;\n  int total = price + 1;\n  total = tal + 1;\n  return total;\n}\n");
  await analyze();
  await page.getByTestId("explanation").getByText("Syntax OK, name problems").waitFor();
  expect(!(await page.getByTestId("explanation").innerText()).includes("Your program is valid MiniC"), "claimed valid");
});

await step("phone width: no horizontal page scroll", async () => {
  const m = await browser.newPage({ viewport: { width: 390, height: 844 } });
  m.on("pageerror", (e) => pageErrors.push(String(e)));
  await m.goto(`${BASE}/`);
  await m.getByTestId("analyze").click();
  await m.getByTestId("explanation").waitFor(T);
  const w = await m.evaluate(() => document.documentElement.scrollWidth);
  expect(w <= 390, `page is ${w}px wide`);
  await m.close();
});

await step("no uncaught page errors", async () => expect(pageErrors.length === 0, pageErrors.join("; ")));

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
