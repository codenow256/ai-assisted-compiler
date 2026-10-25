# IntelliFix: run every test layer on Windows and print a PASS/FAIL/SKIPPED summary.
Set-Location (Join-Path $PSScriptRoot "..\..")
$summary = @(); $failed = $false
function Layer($name, [scriptblock]$body) {
  Write-Host "==> $name"
  & $body
  if ($LASTEXITCODE -eq 0) { $script:summary += "PASS     $name" } else { $script:summary += "FAIL     $name"; $script:failed = $true }
}
Layer "compiler unit tests (ctest)" { ctest --test-dir compiler\build -C Release --output-on-failure }
Layer "backend API tests (pytest)" { Push-Location backend; python -m pytest -q; Pop-Location }
Layer "evaluation tests (pytest)" { python -m pytest -q evaluation\tests }
if (Test-Path frontend\node_modules) {
  Layer "frontend typecheck" { Push-Location frontend; npx tsc -b; Pop-Location }
  Layer "frontend unit tests (vitest)" { Push-Location frontend; npx vitest run; Pop-Location }
} else { $summary += "SKIPPED  frontend tests (run npm ci in frontend)" }
$summary | ForEach-Object { Write-Host $_ }
if ($failed) { exit 1 }
