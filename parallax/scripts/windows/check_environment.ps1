# IntelliFix: report which build/run prerequisites are present on this Windows machine.
$items = @(
  @{n="cmake"; h="CMake"}, @{n="cl"; h="MSVC (only inside the 'x64 Native Tools' prompt)"},
  @{n="g++"; h="MinGW-w64 g++ (MSYS2)"}, @{n="win_bison"; h="winflexbison bison"}, @{n="bison"; h="GNU bison"},
  @{n="win_flex"; h="winflexbison flex"}, @{n="flex"; h="GNU flex"}, @{n="python"; h="Python 3.10+"},
  @{n="node"; h="Node.js 18+"}, @{n="npm"; h="npm"}
)
foreach ($i in $items) {
  $c = Get-Command $i.n -ErrorAction SilentlyContinue
  if ($c) { Write-Host ("FOUND    {0,-10} {1}" -f $i.n, $c.Source) -ForegroundColor Green }
  else    { Write-Host ("missing  {0,-10} {1}" -f $i.n, $i.h) -ForegroundColor Yellow }
}
$exe = @("compiler\build\parallaxc.exe", "compiler\build\Release\parallaxc.exe", "compiler\build\Debug\parallaxc.exe") |
  ForEach-Object { Join-Path (Join-Path $PSScriptRoot "..\..") $_ } | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($exe) { Write-Host "Compiler binary: $exe" -ForegroundColor Green; & $exe version }
else { Write-Host "Compiler binary: NOT BUILT (the web UI will say 'Compiler not built')" -ForegroundColor Yellow }
