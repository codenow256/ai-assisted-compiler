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
  await btn(/^Analyze$/); await shot('05-workbench-full-analysis');
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
    await sample(id); await btn(/^Analyze$/); await shot(n);
    if (id === '06_multiple_errors') { await nav('Hypothesis explorer'); await shot('15b-two-errors-lanes'); }
  }
  await nav('AST explorer'); await shot('08b-ast-explorer-valid');
  await nav('Learning center'); await shot('17-learning-center');
  // Final-round features: explanation, clarification, hints/practice, explained AST, partial tree, before/after.
  const draft = async (src) => {
    await page.evaluate((s) => localStorage.setItem('parallax-draft', JSON.stringify({ source: s, origin: { kind: 'user', label: 'example.mc' } })), src);
    await page.goto('http://127.0.0.1:8000/workbench'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500);
  };
  const analyzeNow = async () => { await page.getByRole('button', { name: /^Analyze$/ }).last().click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(900); };
  await draft("int main() {\n  int price = 5;\n  int total = price + ;\n  return total;\n}\n"); await analyzeNow();
  await shot('20-ambiguity-question');
  await page.getByText('Fill in the missing value or expression yourself').click();
  await page.getByTestId('clarify').getByRole('button', { name: 'price', exact: true }).click();
  await page.getByRole('button', { name: 'Check with the parser' }).click(); await page.waitForTimeout(700);
  await page.getByTestId('clarify').scrollIntoViewIfNeeded(); await shot('21-ambiguity-validated');
  await page.getByRole('button', { name: /Apply and re-analyze/ }).click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(900);
  await shot('22-ambiguity-applied');
  await draft("int main() {\n  int x = 1\n  int y = 2;\n  return x + y;\n}\n"); await analyzeNow();
  await page.getByRole('button', { name: /Show a hint/ }).click(); await page.getByRole('button', { name: /Next hint/ }).click(); await page.getByRole('button', { name: /Next hint/ }).click();
  await page.getByRole('button', { name: /try it in the editor/ }).click();
  await page.locator('.cm-line').nth(1).click(); await page.keyboard.press('End'); await page.keyboard.type(';');
  await page.getByRole('button', { name: 'Check my fix' }).click(); await page.waitForLoadState('networkidle'); await page.waitForTimeout(900);
  await page.getByTestId('practice').scrollIntoViewIfNeeded(); await shot('23-hints-practice');
  await draft("int fact(int n) {\n  if (n <= 1) return 1;\n  return n * fact(n - 1);\n}\n\nint main() {\n  int x = fact(5);\n  return x;\n}\n"); await analyzeNow();
  await shot('24-valid-explained');
  await nav('AST explorer');
  await page.locator('.tree .node').filter({ hasText: 'Binary' }).filter({ hasText: 'op=*' }).first().click(); await page.waitForTimeout(400);
  await shot('25-ast-explained-node');
  await draft("int main() {\n  int a = 1;\n  int b = (a + 2;\n  return b;\n}\n"); await analyzeNow();
  await nav('AST explorer'); await shot('26-ast-partial-tree');
  await draft("int combine(int a, int b) {\n  int c = a b;\n  return c;\n}\n"); await analyzeNow();
  await nav('AST explorer'); await page.getByRole('tab', { name: /Before/ }).click(); await page.getByRole('button', { name: 'Compare ASTs' }).click(); await page.waitForTimeout(900);
  await shot('27-ast-before-after');
  // Same UI against a backend whose compiler binary is missing (port 8001): the real error state.
  await page.goto('http://127.0.0.1:8001/workbench'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(800);
  await page.selectOption('#sample', '02_missing_semicolon'); await page.waitForTimeout(300);
  await btn(/^Analyze$/); await shot('18-compiler-not-built');
  console.log('errors', errs); await b.close();
})();
