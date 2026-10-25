# IntelliFix: start the API and the built UI on http://127.0.0.1:8000 (Windows).
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..\backend")
$port = if ($env:PORT) { $env:PORT } else { "8000" }
python -m uvicorn app.main:app --host 127.0.0.1 --port $port
