const { chromium } = require("playwright");
const cases = Object.fromEntries(require("./cases.json").map(([id, t, s]) => [id, s]));
const BASE = "http://127.0.0.1:8000";
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1440, height: 950 } });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  const T = { timeout: 20000 };
  const out = [];
  const rec = async (id, fn) => { try { const v = await fn(); out.push([id, "PASS", v]); } catch (e) { out.push([id, "FAIL", String(e).split("\n")[0]]); } console.log(out[out.length - 1].join(" | ")); };
  const draft = async (src) => {
    for (let i = 0; i < 4; i++) {
      await page.goto(BASE + "/research"); await page.waitForTimeout(450);
      await page.evaluate((s) => localStorage.setItem("parallax-draft", JSON.stringify({ source: s, origin: { kind: "user", label: "t.mc" } })), src);
      await page.goto(BASE + "/"); await page.locator(".cm-content").first().waitFor();
      if ((await page.evaluate(() => JSON.parse(localStorage.getItem("parallax-draft") ?? "{}").source)) === src) return;
    }
  };
  const analyze = async () => { await page.getByTestId("analyze").click(); await page.getByTestId("explanation").waitFor(T); };
  const step = (n) => page.locator(".stepper").getByRole("button", { name: new RegExp("^" + n) }).click();
  const nav = (n) => page.getByRole("complementary", { name: "Primary" }).getByRole("link", { name: new RegExp("^" + n) }).click();
  const editor = () => page.locator(".ws-editor .cm-content").innerText();

  await rec("T14 user-authored repair, valid", async () => {
    await draft(cases.T10); await analyze(); await step("Fixes");
    const q = page.getByTestId("clarify");
    await q.getByText(/Something else: write line 3/).click();
    await q.getByLabel("Your version of line 3").fill("  int total = price + 1;");
    await q.getByRole("button", { name: "Check with the parser" }).click();
    await q.getByText("Valid MiniC").waitFor(T);
    await q.getByRole("button", { name: /Use this answer/ }).click();
    await page.getByText(/the parser skipped/).waitFor(T);
    await step("Apply & verify"); await page.getByTestId("apply").click();
    await page.getByText(/Verified/).waitFor(T);
    return (await editor()).split("\n")[2];
  });
  await rec("T15 user-authored repair, still invalid", async () => {
    await draft(cases.T10); await analyze(); await step("Fixes");
    const q = page.getByTestId("clarify");
    await q.getByText(/Something else: write line 3/).click();
    await q.getByLabel("Your version of line 3").fill("  int total = price + * 2;");
    await q.getByRole("button", { name: "Check with the parser" }).click();
    const msg = await q.locator(".banner").filter({ hasText: "Not valid yet" }).innerText({ timeout: 20000 });
    const disabled = await q.getByRole("button", { name: /Use this answer/ }).isDisabled();
    if (!disabled) throw new Error("Use this answer enabled for invalid answer");
    return msg.replace(/\n/g, " ") + " | Use this answer disabled";
  });
  await rec("T15b practice: student's own invalid edit", async () => {
    await draft(cases.T07); await analyze();
    await page.getByRole("button", { name: /try it in the editor/ }).click();
    await page.locator(".ws-editor .cm-line").nth(1).click(); await page.keyboard.press("End"); await page.keyboard.type(" +");
    await page.getByRole("button", { name: "Check my fix" }).click();
    const fb = page.getByTestId("practice").locator(".banner");
    await fb.waitFor(T); return (await fb.innerText()).replace(/\n/g, " ");
  });
  await rec("T23 apply → verify → undo → re-analysis", async () => {
    await draft(cases.T07); await analyze();
    await page.getByRole("button", { name: /Compare fixes/ }).click();
    await page.getByTestId("recommended").getByRole("button", { name: /Use this fix/ }).click();
    await step("Apply & verify"); await page.getByTestId("apply").click();
    await page.getByText(/Verified/).waitFor(T);
    const v = (await page.getByTestId("verify").innerText()).split("\n").slice(0, 3).join(" ");
    const fixed = await editor();
    await page.getByTestId("verify").getByRole("button", { name: /Undo repair/ }).click();
    await page.getByTestId("explanation").getByText("Missing delimiter").waitFor(T);
    const back = await editor();
    if (!fixed.includes("int x = 1;") || back.includes("int x = 1;")) throw new Error("apply/undo text wrong");
    return v + " | after undo: diagnosis shows Missing delimiter again";
  });
  await rec("T24 AST before/after (two repairs)", async () => {
    await draft(cases.T12); await analyze(); await nav("AST Explorer");
    await page.getByRole("tab", { name: /Before/ }).click();
    const t = await page.locator(".change-row").first().innerText(T);
    return t.replace(/\n/g, " ");
  });
  await rec("E1 AST: expand/collapse, sibling and parent navigation, search", async () => {
    await draft(cases.T06); await nav("AST Explorer"); await page.locator(".outline .ocell").first().waitFor(T);
    const before = await page.locator(".orow").count();
    await page.getByRole("button", { name: "Collapse all" }).click(); const collapsed = await page.locator(".orow").count();
    await page.getByRole("button", { name: "Expand all" }).click(); const expanded = await page.locator(".orow").count();
    await page.locator(".ocell").filter({ hasText: /^.*For/ }).first().click();
    const card = page.getByTestId("node-card");
    await card.getByRole("button", { name: /next sibling/ }).click();
    const sib = await card.locator("h3").innerText();
    await card.getByRole("button", { name: "Block" }).first().click();
    const parent = await card.locator("h3").innerText();
    await page.getByPlaceholder(/Find:/).fill("While");
    const hits = await page.locator(".orow.hit").count();
    return `rows default ${before}, collapsed ${collapsed}, expanded ${expanded}; For → next sibling = ${sib}; parent = ${parent}; search While hits ${hits}`;
  });
  await rec("E2 AST: expression diagram only for expressions", async () => {
    await draft(cases.T03); await nav("AST Explorer"); await page.locator(".outline .ocell").first().waitFor(T);
    const card = page.getByTestId("node-card");
    await page.locator(".ocell").filter({ hasText: /Param/ }).first().click();
    const onParam = await card.locator("svg.expr-diagram").count();
    await page.locator(".ocell").filter({ hasText: /Binary\s*-/ }).first().click();
    const onMinus = await card.locator("svg.expr-diagram .dnode").count();
    const notes = await card.locator("section").filter({ hasText: "Expression structure" }).innerText();
    await page.locator(".ocell").filter({ hasText: /^.*Function/ }).first().click();
    const onFn = await card.locator("svg.expr-diagram").count();
    return `Param: ${onParam} diagram; Function: ${onFn} diagram; Binary - : ${onMinus} drawn nodes; notes: ${notes.replace(/\n/g, " ").slice(0, 260)}`;
  });
  await rec("E3 AST: partial tree after syntax error + After-the-fix toggle", async () => {
    await draft(cases.T09); await analyze(); await nav("AST Explorer");
    await page.getByText("Partial tree: your code has syntax errors").waitFor(T);
    const errNodes = await page.locator(".okind").filter({ hasText: /^Error$/ }).count();
    await page.getByRole("button", { name: "After the fix" }).click();
    await page.getByText(/This is the tree of the repaired program/).waitFor(T);
    const badge = await page.locator(".ast-toolbar .badge").innerText();
    return `Error nodes in partial tree: ${errNodes}; after toggle: "${badge}"`;
  });
  await rec("E4 AST: empty program and no-tree states", async () => {
    await draft(""); await nav("AST Explorer"); await page.locator(".outline .ocell").first().waitFor(T);
    const rows = await page.locator(".orow").count();
    await draft(cases.T22); await analyze(); await nav("AST Explorer"); await page.waitForTimeout(1500);
    const t = await page.locator(".panel-body").first().innerText();
    return `empty: ${rows} row (Program); non-code input: ${t.replace(/\n/g, " ").slice(0, 200)}`;
  });
  await rec("E5 AST: 64 KB program (25k nodes) stays responsive", async () => {
    await draft(cases.T25c); const t0 = Date.now(); await nav("AST Explorer");
    await page.locator(".outline .ocell").first().waitFor({ timeout: 60000 });
    const ms = Date.now() - t0;
    const note = await page.getByRole("note").innerText();
    const t1 = Date.now(); await page.getByPlaceholder(/Find:/).fill("Return"); await page.locator(".orow.hit").first().waitFor(T); const sms = Date.now() - t1;
    return `opened in ${ms} ms (incl. parse); rows ${await page.locator(".orow").count()}; "${note}"; search ${sms} ms`;
  });
  await rec("E6 AST: deep nesting 4000 parentheses", async () => {
    await draft(cases.T21a); await nav("AST Explorer"); await page.locator(".outline .ocell").first().waitFor({ timeout: 60000 });
    return `rows ${await page.locator(".orow").count()} (parentheses create no nodes)`;
  });
  console.log("page errors:", errs.length ? errs : "none");
  require("fs").writeFileSync("ui2_results.json", JSON.stringify({ out, errs }, null, 1));
  await b.close();
})();
