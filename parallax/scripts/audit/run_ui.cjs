const { chromium } = require("playwright");
const cases = require("./cases.json");
const BASE = "http://127.0.0.1:8000";
(async () => {
  const b = await chromium.launch(); const page = await b.newPage({ viewport: { width: 1440, height: 950 } });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
  const res = {};
  const draft = async (src) => {
    for (let i = 0; i < 4; i++) {
      await page.goto(BASE + "/research"); await page.waitForTimeout(450);
      await page.evaluate((s) => localStorage.setItem("parallax-draft", JSON.stringify({ source: s, origin: { kind: "user", label: "t.mc" } })), src);
      await page.goto(BASE + "/"); await page.locator(".cm-content").first().waitFor();
      if ((await page.evaluate(() => JSON.parse(localStorage.getItem("parallax-draft") ?? "{}").source)) === src) return true;
    }
    return false;
  };
  for (const [id, title, src] of cases) {
    const r = { title };
    try {
      if (!(await draft(src))) throw new Error("draft not loaded");
      const t0 = Date.now();
      await page.getByTestId("analyze").click();
      await Promise.race([page.getByTestId("explanation").waitFor({ timeout: 60000 }), page.locator(".banner.tone-danger").first().waitFor({ timeout: 60000 })]);
      r.ms = Date.now() - t0;
      const ex = page.getByTestId("explanation");
      if (await ex.count()) {
        r.category = (await ex.locator(".badge").first().innerText()).trim();
        r.headline = (await ex.locator("h3").first().innerText()).trim();
        r.question = null;
      } else r.error = (await page.locator(".ws-step").innerText()).slice(0, 200).replace(/\n/g, " | ");
      r.stepper = (await page.locator(".stepper").innerText()).replace(/\n/g, " ");
      // Fixes step
      const fixes = page.locator(".stepper").getByRole("button", { name: /^Fixes/ });
      if (await fixes.isEnabled()) {
        await fixes.click(); await page.waitForTimeout(300);
        const s = page.locator(".ws-step");
        r.fixes = { recommended: await s.getByTestId("recommended").count(), question: (await s.locator(".clarify-q").count()) ? (await s.locator(".clarify-q").innerText()) : null, cards: await s.getByTestId("fix-card").count(), custom: await s.getByLabel(/Your version of line/).count(), text: (await s.innerText()).slice(0, 160).replace(/\n/g, " | ") };
      }
      // Tree step
      const tree = page.locator(".stepper").getByRole("button", { name: /^Tree/ });
      if (await tree.isEnabled()) { const t1 = Date.now(); await tree.click(); await page.waitForTimeout(500); r.tree = (await page.locator(".ws-step").innerText()).slice(0, 140).replace(/\n/g, " | "); r.treeMs = Date.now() - t1; }
    } catch (e) { r.fail = String(e).split("\n")[0]; }
    res[id] = r;
    console.log(id, JSON.stringify(r).slice(0, 420));
  }
  require("fs").writeFileSync("ui_results.json", JSON.stringify({ res, errs }, null, 1));
  console.log("page errors:", errs);
  await b.close();
})();
