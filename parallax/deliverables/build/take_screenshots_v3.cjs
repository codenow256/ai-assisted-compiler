// Screenshots of the sequential, safety-aware correction workflow (real compiler).
// Usage (from parallax/, backend on :8000): node deliverables/build/take_screenshots_v3.cjs
// Writes docs/images/walkthrough/v3-*.png (panels, scale 1.5).
const { chromium } = require("playwright");
const path = require("path");
const OUT = path.resolve(__dirname, "../../docs/images/walkthrough") + "/";
const BASE = "http://127.0.0.1:8000";
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 950 }, deviceScaleFactor: 1.5, colorScheme: "light" });
  const page = await ctx.newPage();
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  const T = { timeout: 20000 };
  const el = async (n, loc) => { await page.waitForTimeout(400); await loc.screenshot({ path: OUT + n + ".png" }); console.log("shot", n); };
  const draft = async (src) => {
    for (let i = 0; i < 4; i++) {
      await page.goto(BASE + "/research"); await page.waitForTimeout(500);
      await page.evaluate((s) => localStorage.setItem("parallax-draft", JSON.stringify({ source: s, origin: { kind: "user", label: "several_errors.mc" } })), src);
      await page.goto(BASE + "/"); await page.locator(".cm-content").first().waitFor();
      if ((await page.evaluate(() => JSON.parse(localStorage.getItem("parallax-draft") ?? "{}").source)) === src) return;
    }
  };
  const stepBtn = (n) => page.locator(".stepper").getByRole("button", { name: new RegExp("^" + n) });
  const apply = async () => {
    await page.getByRole("button", { name: "Apply & verify", exact: true }).click();
    await page.getByTestId("apply").click();
    await Promise.race([page.getByTestId("next-error").waitFor(T), page.getByTestId("completion").waitFor(T)]);
  };
  await draft("int main() {\n  int price = 5\n  int total = price + ;\n  total++;\n  return total\n}\n");
  await page.getByTestId("analyze").click(); await page.getByTestId("explanation").waitFor(T);
  await el("v3-stepper", page.locator(".stepper"));
  await el("v3-workspace", page.locator(".ws"));
  await el("v3-reports", page.locator("section[aria-label='Error reports']"));
  await stepBtn("Fixes").click();
  await el("v3-sequential-fixes", page.locator(".ws-step"));
  await page.getByTestId("recommended").getByRole("button", { name: /Use this fix/ }).click();
  await apply();
  await el("v3-next-error", page.getByTestId("verify"));
  await page.getByTestId("next-error-btn").click();
  const q = page.getByTestId("clarify");
  await q.getByText("Is the + extra, or is something missing after it?").waitFor(T);
  await page.getByText(/The engine's complete plan for all errors at once/).click();
  await el("v3-full-plan-warning", page.getByTestId("full-plan"));
  await q.getByText("Fill in the missing value or expression yourself").click();
  await q.getByRole("button", { name: "price", exact: true }).click();
  await q.getByRole("button", { name: "Check with the parser" }).click();
  await q.getByText("This error is fixed; later errors remain").waitFor(T);
  await el("v3-question-answered", q);
  await q.getByRole("button", { name: /Use this answer/ }).click();
  await apply(); await page.getByTestId("next-error-btn").click();
  const rw = page.getByTestId("rewrite");
  await rw.getByRole("button", { name: "Check with the parser" }).click(); await rw.locator(".banner").waitFor(T);
  await el("v3-rewrite", rw);
  await rw.getByRole("button", { name: /Use this rewrite/ }).click();
  await apply(); await page.getByTestId("next-error-btn").click();
  await page.getByTestId("recommended").getByRole("button", { name: /Use this fix/ }).click();
  await apply();
  await el("v3-completion", page.getByTestId("verify"));
  await el("v3-stepper-done", page.locator(".stepper"));
  // name check: syntax fine, name wrong
  await draft("int main() {\n  int price = 5;\n  int total = price + 1;\n  total = tal + 1;\n  return total;\n}\n");
  await page.getByTestId("analyze").click(); await page.getByTestId("explanation").waitFor(T);
  await el("v3-name-warning", page.getByTestId("explanation").locator("> div").first());
  console.log("page errors:", errs.length ? errs : "none");
  await b.close();
})().catch((e) => { console.error(e); process.exit(1); });
