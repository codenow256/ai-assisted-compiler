# IntelliFix: build the native compiler and the web UI on Windows.
# Run from the repository's parallax\ folder:  powershell -ExecutionPolicy Bypass -File scripts\windows\build.ps1
# Needs: CMake, a C++17 compiler (MSVC from Visual Studio Build Tools, or MSYS2 MinGW-w64),
#        Bison >= 3.6 and Flex (win_bison/win_flex from winflexbison, or MSYS2 bison/flex), Node.js.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..\..")

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Write-Host "MISSING: $cmd  ->  $hint" -ForegroundColor Red; return $false }
  return $true
}
$ok = $true
$ok = (Need cmake "install CMake (https://cmake.org) or the Visual Studio 'C++ CMake tools' component") -and $ok
$haveBison = (Get-Command bison -ErrorAction SilentlyContinue) -or (Get-Command win_bison -ErrorAction SilentlyContinue)
$haveFlex  = (Get-Command flex  -ErrorAction SilentlyContinue) -or (Get-Command win_flex  -ErrorAction SilentlyContinue)
if (-not $haveBison) { Write-Host "MISSING: bison/win_bison -> winget install WinFlexBison.win_flexbison  (or MSYS2: pacman -S bison)" -ForegroundColor Red; $ok = $false }
if (-not $haveFlex)  { Write-Host "MISSING: flex/win_flex   -> winget install WinFlexBison.win_flexbison  (or MSYS2: pacman -S flex)"  -ForegroundColor Red; $ok = $false }
$haveMsvc = [bool](Get-Command cl -ErrorAction SilentlyContinue)
$haveGcc  = [bool](Get-Command g++ -ErrorAction SilentlyContinue)
if (-not ($haveMsvc -or $haveGcc)) {
  Write-Host "MISSING: a C++ compiler. Either:" -ForegroundColor Red
  Write-Host "  (a) Visual Studio Build Tools with the 'Desktop development with C++' workload, then run this script"
  Write-Host "      from the 'x64 Native Tools Command Prompt for VS' (that is what puts cl.exe on PATH), or"
  Write-Host "  (b) MSYS2: pacman -S mingw-w64-ucrt-x86_64-gcc mingw-w64-ucrt-x86_64-cmake mingw-w64-ucrt-x86_64-ninja bison flex"
  Write-Host "      and add C:\msys64\ucrt64\bin and C:\msys64\usr\bin to PATH."
  $ok = $false
}
if (-not $ok) { Write-Host "`nThe native compiler cannot be built yet; the web UI will show 'Compiler not built'." -ForegroundColor Yellow; exit 1 }

if ($haveMsvc) {
  cmake -S compiler -B compiler\build
  cmake --build compiler\build --config Release
} else {
  cmake -S compiler -B compiler\build -G Ninja -DCMAKE_BUILD_TYPE=Release
  cmake --build compiler\build
}
ctest --test-dir compiler\build -C Release --output-on-failure

if (Get-Command npm -ErrorAction SilentlyContinue) {
  Push-Location frontend; npm ci; npm run build; Pop-Location
} else { Write-Host "npm not found: install Node.js 18+ to build the UI" -ForegroundColor Yellow }
Write-Host "`nDone. Start the server with: powershell -File scripts\windows\run_backend.ps1" -ForegroundColor Green
