# Audit scripts (test matrix of docs/INTELLIFIX_TEST_MATRIX.md)

Start the backend first (`./scripts/run_backend.sh`, with `frontend/dist` built). Then, from this folder:

```bash
python3 run_api.py            # every case through POST /api/repair → api_results.json
python3 make_cases_json.py    # cases.json for the browser scripts
node run_ui.cjs               # every case through the real website (Chromium) → ui_results.json
node run_ui2.cjs              # interactive checks T14, T15, T23, T24, E1–E6 → ui2_results.json
```

The browser scripts need Playwright with Chromium (`npm install playwright && npx playwright install chromium` if it is not already available). The scripts only read results; they change nothing in the project. The generated `*.json` files are not part of the repository.
