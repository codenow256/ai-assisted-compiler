const { chromium } = require('playwright');
const path = require('path');
const OUT = path.resolve(__dirname, '../../docs/images/walkthrough') + '/';  // run: node deliverables/build/take_screenshots.cjs (backend on :8000; optional :8001 without a compiler)
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, colorScheme: 'light' });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  const shot = async (n) => { await page.waitForTimeout(500); await page.screenshot({ path: OUT + n + '.png' }); console.log('shot', n); };
  const go = async (path) => { await page.goto('http://127.0.0.1:8000' + path); await page.waitForLoadState('networkidle'); await page.waitForTimeout(600); };
  const btn = async (re) => { await page.getByRole('button', { name: re }).first().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800); };
  const nav = async (label) => { await page.getByRole('link', { name: label, exact: true }).first().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(700); };
  const sample = async (id) => { await nav('Code workbench'); await page.selectOption('#sample', id); await page.waitForTimeout(400); };

  await go('/'); await shot('01-overview');
  await sample('02_missing_semicolon'); await shot('02-workbench-loaded');
  await btn(/^Run lexer/); await shot('03-workbench-after-lexer');
  await btn(/^Run parser/); await shot('04-workbench-after-parser');
  await btn(/^Full analysis/); await shot('05-workbench-full-analysis');
  await nav('Lexical analysis'); await shot('06-lexical-analysis');
  await nav('Grammar & parsing'); await shot('07-grammar-and-parsing');
  await nav('AST explorer'); await shot('08-ast-explorer');
  await nav('Repair laboratory'); await shot('09-repair-laboratory');
  await page.mouse.wheel(0, 700); await shot('09b-repair-laboratory-evidence');
  await nav('Hypothesis explorer'); await shot('10-hypothesis-explorer');
  await nav('Evaluation & impact'); await shot('11-evaluation');
  await page.mouse.wheel(0, 800); await shot('11b-evaluation-charts');
  for (const [id, n] of [['07_ambiguous_operator', '12-multiple-plausible'], ['08_abstain_missing_name', '13-low-confidence'],
                         ['11_unsupported_construct', '14-unsupported-construct'], ['06_multiple_errors', '15-two-errors'],
                         ['01_valid_basic', '16-valid-program']]) {
    await sample(id); await btn(/^Full analysis/); await shot(n);
    if (id === '06_multiple_errors') { await nav('Hypothesis explorer'); await shot('15b-two-errors-lanes'); }
  }
  await nav('AST explorer'); await shot('08b-ast-explorer-valid');
  await nav('Learning center'); await shot('17-learning-center');
  // Same UI against a backend whose compiler binary is missing (port 8001): the real error state.
  await page.goto('http://127.0.0.1:8001/workbench'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
  await page.selectOption('#sample', '02_missing_semicolon'); await page.waitForTimeout(300);
  await btn(/^Full analysis/); await shot('18-compiler-not-built');
  console.log('errors', errs); await b.close();
})();
