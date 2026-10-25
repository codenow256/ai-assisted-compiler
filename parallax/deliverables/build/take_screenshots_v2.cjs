// Screenshots of the simplified interface (Workspace / AST Explorer / Research & Method).
// Every image is the running application on the real compiler. Usage (from parallax/):
//   backend on :8000 (and optionally a second one on :8001 with PARALLAX_COMPILER=/nonexistent)
//   node deliverables/build/take_screenshots_v2.cjs
// Writes docs/images/walkthrough/v2-*.png (full pages, 1440 px wide at scale 1.5) and
// v2-el-*.png (single panels, used by the final presentation).
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.resolve(__dirname, "../../docs/images/walkthrough") + "/";
const BASE = "http://127.0.0.1:8000";

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, colorScheme: "light" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  const T = { timeout: 15000 };
  const full = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: OUT + n + ".png", fullPage: true }); console.log("shot", n); };
  const el = async (n, sel) => { await page.waitForTimeout(400); await page.locator(sel).first().screenshot({ path: OUT + n + ".png" }); console.log("shot", n); };
  const draft = async (src, label = "example.mc") => {
    for (let i = 0; i < 4; i++) {
      await page.goto(BASE + "/research"); await page.waitForTimeout(500);
      await page.evaluate(([s, l]) => localStorage.setItem("parallax-draft", JSON.stringify({ source: s, origin: { kind: "user", label: l } })), [src, label]);
      await page.goto(BASE + "/"); await page.locator(".cm-content").first().waitFor();
      if ((await page.evaluate(() => JSON.parse(localStorage.getItem("parallax-draft") ?? "{}").source)) === src) return;
    }
  };
  const analyze = async () => { await page.getByTestId("analyze").click(); await page.getByTestId("explanation").waitFor(T); await page.waitForLoadState("networkidle"); };
  const stepBtn = (name) => page.locator(".stepper").getByRole("button", { name: new RegExp("^" + name) });
  const nav = async (name) => { await page.getByRole("complementary", { name: "Primary" }).getByRole("link", { name: new RegExp("^" + name) }).click(); await page.waitForLoadState("networkidle"); await page.waitForTimeout(500); };

  // 1. start
  await draft("", "untitled.mc");
  await full("v2-01-workspace-start");
  // 2. missing semicolon: diagnosis, recommended fix, verified
  await draft("int main() {\n  int total = 0\n  return total;\n}\n", "missing_semicolon.mc");
  await analyze(); await full("v2-02-diagnosis"); await el("v2-el-diagnosis", ".ws-step");
  await page.getByRole("button", { name: /Compare fixes/ }).click(); await full("v2-03-recommended");
  // 3. ambiguity
  await draft("int main() {\n  int price = 5;\n  int total = price + ;\n  return total;\n}\n", "missing_expression.mc");
  await analyze(); await stepBtn("Fixes").click(); await full("v2-04-ambiguity-question"); await el("v2-el-ambiguity-question", ".ws");
  const q = page.getByTestId("clarify");
  await q.getByText("Fill in the missing value or expression yourself").click();
  await q.getByRole("button", { name: "price", exact: true }).click();
  await q.getByRole("button", { name: "Check with the parser" }).click(); await q.getByText("Valid MiniC").waitFor(T);
  await el("v2-el-ambiguity-validated", "[data-testid=clarify]");
  await q.getByRole("button", { name: /Use this answer/ }).click(); await page.getByText(/the parser skipped/).waitFor(T);
  await full("v2-05-tree-step"); await el("v2-el-tree-step", ".ws-step");
  await page.getByRole("button", { name: "Apply & verify", exact: true }).click(); await full("v2-06-ready-to-apply");
  await page.getByTestId("apply").click(); await page.getByText(/Verified/).waitFor(T); await full("v2-07-verified"); await el("v2-el-verified", ".ws-step");
  // 4. two errors: cascade
  await draft("int main() {\n  int x = 1\n  if (x > 0 {\n    x = 2;\n  }\n  return x;\n}\n", "two_errors.mc");
  await analyze(); await full("v2-08-cascade"); await el("v2-el-cascade", "section[aria-label='Error reports']");
  // 5. hints and practice
  await draft("int main() {\n  int x = 1\n  return x;\n}\n", "practice.mc");
  await analyze();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: /Show a hint|Next hint/ }).click();
  await page.getByRole("button", { name: /try it in the editor/ }).click();
  await page.locator(".ws-editor .cm-line").nth(1).click(); await page.keyboard.press("End"); await page.keyboard.type(";");
  await page.getByRole("button", { name: "Check my fix" }).click(); await page.getByText("Your fix works").waitFor(T);
  await full("v2-09-hints-practice"); await el("v2-el-hints-practice", ".ws-step");
  // 6. unterminated comment (no fix offered; custom answer)
  await draft("int main() {\n  int x = 1;\n  /* the comment never ends\n  return x;\n}\n", "unterminated.mc");
  await analyze(); await full("v2-10-unterminated-comment");
  // 7. AST explorer
  await draft("int square(int n) {\n  return n * n;\n}\n\nint main() {\n  int total = 0;\n  int i;\n  for (i = 0; i < 3; i = i + 1) {\n    total = total + square(i) * 2;\n  }\n  return total;\n}\n", "loop.mc");
  await nav("AST Explorer"); await page.locator(".outline .ocell").first().waitFor(T);
  await full("v2-11-ast-explorer-start");
  await page.locator(".ocell").filter({ hasText: /Binary\s*\+/ }).nth(1).click(); await full("v2-12-ast-node-expression"); await el("v2-el-ast-node", "[data-testid=node-card]");
  await el("v2-el-ast-grid", ".ast-grid");
  await draft("int main() {\n  int a = 1;\n  int b = (a + 2;\n  return b;\n}\n", "partial.mc");
  await analyze(); await nav("AST Explorer"); await page.getByText("Partial tree: your code has syntax errors").waitFor(T);
  await full("v2-13-ast-partial-tree"); await el("v2-el-ast-partial", ".ast-grid");
  await draft("int combine(int a, int b) {\n  int c = a b;\n  return c;\n}\n", "ambiguous_operator.mc");
  await analyze(); await nav("AST Explorer"); await page.getByRole("tab", { name: /Before/ }).click(); await page.getByText(/structural change/).waitFor(T);
  await full("v2-14-ast-before-after"); await el("v2-el-ast-before-after", ".panel-body .stack");
  // 8. research
  await nav("Research & Method"); await page.getByText(/Research question\./).waitFor(T);
  await full("v2-15-research");
  await el("v2-el-research-key", ".research section:nth-of-type(3)");
  await el("v2-el-research-tradeoff", ".research section:nth-of-type(4)");
  // 9. compiler missing (second backend without a compiler binary), if running
  try {
    await page.goto("http://127.0.0.1:8001/"); await page.getByTestId("analyze").click();
    await page.getByText("Compiler not built").waitFor({ timeout: 8000 }); await full("v2-16-compiler-missing");
  } catch { console.log("skip v2-16 (no :8001 backend)"); }
  console.log("page errors:", errs.length ? errs : "none");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
