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
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

await step("workbench loads samples from the backend", async () => {
  await page.goto(`${BASE}/workbench`);
  await page.waitForFunction(() => document.querySelectorAll("#sample option").length > 5, null, { timeout: 10000 });
});

await step("missing semicolon: real run yields RECOMMENDED with the expected repair", async () => {
  await page.selectOption("#sample", "02_missing_semicolon");
  await page.keyboard.press("Control+Enter");
  await page.getByTestId("explanation").getByText(/IntelliFix recommends one fix/).waitFor({ timeout: 10000 });
  const ex = await page.getByTestId("explanation").innerText();
  expect(/Line 4: the parser did not expect the type keyword int/.test(ex), "plain-language headline missing");
  expect(/previous line \(3\) is missing its ;/.test(ex), "missing-semicolon explanation missing");
  expect(await page.locator(".topbar").getByText("Recommended repair").count() > 0, "status badge missing");
});

await step("accept needs confirmation, applies, and undo restores the original", async () => {
  await page.getByRole("button", { name: "Accept repair" }).click();
  await page.getByRole("button", { name: "Apply" }).click();
  await page.getByText("1 repair applied").waitFor();
  const text = await page.locator(".cm-content").innerText();
  expect(text.includes("int total = 0;"), "editor not updated");
  await page.getByRole("button", { name: "Undo repair" }).click();
  await page.waitForFunction(() => !document.body.innerText.includes("1 repair applied"));
  expect(!(await page.locator(".cm-content").innerText()).includes("int total = 0;"), "undo failed");
});

await step("a page refresh keeps the editor draft", async () => {
  await page.waitForTimeout(600); // draft is saved after a short debounce
  await page.reload();
  await page.locator(".cm-content").waitFor();
  expect((await page.locator(".cm-content").innerText()).includes("int total = 0"), "draft lost on refresh");
  expect((await page.locator(".file-chip").innerText()).includes("02_missing_semicolon"), "file label lost");
});

await step("lexer view: selecting a token highlights it and shows its Flex rule", async () => {
  await page.getByRole("link", { name: "Lexical analysis" }).click();
  await page.getByRole("button", { name: /Run lexer/ }).first().click();
  await page.locator("tbody tr").nth(3).click();
  await page.locator(".cm-hl-select").first().waitFor();
  await page.getByText("Flex rule(s) that emit this kind").waitFor();
});

await step("parser view shows exact expected tokens and LR items", async () => {
  await page.getByRole("link", { name: "Grammar & parsing" }).click();
  await page.getByRole("button", { name: /Run parser/ }).first().click();
  await page.getByText(/Expected here/).waitFor();
  await page.getByText(/Grammar items in state/).waitFor();
});

await step("ambiguous operator: IntelliFix lists alternatives instead of recommending", async () => {
  await page.getByRole("link", { name: "Code workbench" }).click();
  await page.selectOption("#sample", "07_ambiguous_operator");
  await page.keyboard.press("Control+Enter");
  await page.locator(".topbar").getByText("Multiple plausible repairs").waitFor({ timeout: 10000 });
  await page.getByRole("link", { name: "Repair laboratory" }).first().click();
  await page.getByRole("tab", { name: /AST classes/ }).click();
  await page.getByText(/structurally distinct outcomes/).waitFor();
});

await step("hypothesis lanes for two errors", async () => {
  await page.getByRole("link", { name: "Code workbench" }).click();
  await page.selectOption("#sample", "06_multiple_errors");
  await page.keyboard.press("Control+Enter");
  await page.locator(".topbar").getByText("Recommended repair").waitFor({ timeout: 10000 });
  await page.getByRole("link", { name: "Hypothesis explorer" }).first().click();
  await page.getByText("stable across tested hypotheses").first().waitFor();
});

await step("AST compare: repaired program vs candidate", async () => {
  await page.getByRole("link", { name: "AST explorer" }).first().click();
  await page.getByRole("button", { name: /Build AST/ }).first().click();
  await page.getByRole("tab", { name: /Before/ }).click();
  await page.getByRole("button", { name: /Compare ASTs/ }).click();
  await page.locator(".banner").filter({ hasText: /structural change|No node-by-node|Structurally identical/ }).first().waitFor();
});

await step("evaluation page renders stored measured results", async () => {
  await page.getByRole("link", { name: "Evaluation & impact" }).click();
  await page.getByText("What the experiment shows").waitFor({ timeout: 10000 });
  await page.getByText(/not real student code/).waitFor();
});

await step("guided demo drives real runs and can be exited", async () => {
  await page.getByRole("button", { name: "Guided demo" }).click();
  await page.getByText("Step 1 of 16").waitFor();
  await page.getByRole("button", { name: /Next/ }).click();
  await page.getByText("Step 2 of 16").waitFor();
  await page.getByRole("button", { name: "Exit demo" }).click();
  expect((await page.getByText("Step 2 of 16").count()) === 0, "demo did not close");
});

const loadDraft = async (src) => {
  await page.evaluate((s) => localStorage.setItem("parallax-draft", JSON.stringify({ source: s, origin: { kind: "user", label: "e2e.mc" } })), src);
  await page.goto(`${BASE}/workbench`);
  await page.locator(".cm-content").waitFor();
};
const analyze = async () => {
  await page.getByRole("button", { name: /^Analyze$/ }).last().click();
  await page.getByTestId("explanation").waitFor({ timeout: 10000 });
};

await step("ambiguity: the user fills in the missing expression; the parser validates it; apply re-analyzes", async () => {
  await loadDraft("int main() {\n  int price = 5;\n  int total = price + ;\n  return total;\n}\n");
  await analyze();
  await page.getByTestId("clarify").waitFor();
  await page.getByText("Fill in the missing value or expression yourself").click();
  await page.getByTestId("clarify").getByRole("button", { name: "price", exact: true }).click();
  await page.getByRole("button", { name: "Check with the parser" }).click();
  await page.getByTestId("clarify").getByText("Valid MiniC").waitFor();
  await page.getByRole("button", { name: /Apply and re-analyze/ }).click();
  await page.getByTestId("explanation").getByText(/Your program is valid MiniC/).waitFor({ timeout: 10000 });
  expect((await page.locator(".cm-content").innerText()).includes("price + price"), "fill-in not applied");
  await page.getByRole("button", { name: "Undo repair" }).click();
  await page.waitForFunction(() => document.querySelector(".cm-content")?.textContent?.includes("price + ;"));
});

await step("student practice: progressive hints, then the student's own fix is checked", async () => {
  await loadDraft("int main() {\n  int x = 1\n  return x;\n}\n");
  await analyze();
  await page.getByRole("button", { name: /Show a hint/ }).click();
  await page.getByText(/Look at line 3/).waitFor();
  await page.getByRole("button", { name: /try it in the editor/ }).click();
  await page.locator(".cm-line").nth(1).click();
  await page.keyboard.press("End");
  await page.keyboard.type(";");
  await page.getByRole("button", { name: "Check my fix" }).click();
  await page.getByText("Your fix works: the program now parses.").waitFor({ timeout: 10000 });
});

await step("AST explorer: a selected node is explained and search finds nodes", async () => {
  await page.getByRole("link", { name: "AST explorer", exact: true }).first().click();
  await page.locator(".tree .node").filter({ hasText: "Return" }).first().click();
  await page.getByText("Ends the function and gives back a value.").waitFor();
  await page.getByText(/statement 2/).first().waitFor();
  await page.getByPlaceholder(/Find a node/).fill("x");
  expect((await page.locator(".tree .node.hit").count()) >= 2, "search did not mark nodes");
});

await step("invalid code: the AST explorer shows a labelled partial tree, not a fake AST", async () => {
  await loadDraft("int main() {\n  int a = 1;\n  int b = (a + 2;\n  return b;\n}\n");
  await analyze();
  await page.getByRole("link", { name: "AST explorer", exact: true }).first().click();
  await page.getByText("Your code has syntax errors, so there is no complete AST").waitFor();
  await page.getByText("Partial tree from error recovery").waitFor();
  await page.getByRole("button", { name: /Show the AST after the top-ranked repair/ }).click();
  await page.getByText(/AST after the top-ranked repair/).first().waitFor();
});

await step("empty input gets a clear explanation", async () => {
  await loadDraft("");
  await analyze();
  await page.getByTestId("explanation").getByText(/The editor is empty/).waitFor();
});

await step("no uncaught page errors", async () => expect(pageErrors.length === 0, pageErrors.join("; ")));

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
