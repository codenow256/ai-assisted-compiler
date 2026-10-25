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
  await page.getByText("insert ';' at 3:16").first().waitFor({ timeout: 10000 });
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
  await page.getByRole("link", { name: "Repair laboratory" }).click();
  await page.getByRole("tab", { name: /AST classes/ }).click();
  await page.getByText(/structurally distinct outcomes/).waitFor();
});

await step("hypothesis lanes for two errors", async () => {
  await page.getByRole("link", { name: "Code workbench" }).click();
  await page.selectOption("#sample", "06_multiple_errors");
  await page.keyboard.press("Control+Enter");
  await page.locator(".topbar").getByText("Recommended repair").waitFor({ timeout: 10000 });
  await page.getByRole("link", { name: "Hypothesis explorer" }).click();
  await page.getByText("stable across tested hypotheses").first().waitFor();
});

await step("AST compare: repaired program vs candidate", async () => {
  await page.getByRole("link", { name: "AST explorer" }).click();
  await page.getByRole("button", { name: /Build AST/ }).first().click();
  await page.getByRole("tab", { name: /Compare/ }).click();
  await page.getByRole("button", { name: /Compare ASTs/ }).click();
  await page.locator(".banner").filter({ hasText: /structural|Cannot compare|Structurally identical/ }).first().waitFor();
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

await step("no uncaught page errors", async () => expect(pageErrors.length === 0, pageErrors.join("; ")));

await browser.close();
for (const r of results) console.log(r.join("  "));
const failed = results.filter((r) => r[0] === "FAIL").length;
console.log(`${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
