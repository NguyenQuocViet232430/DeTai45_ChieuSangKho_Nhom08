$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$testDir = Join-Path $PSScriptRoot 'host'
$outputDir = Join-Path $projectDir '.pio/host-tests-week45'
$vswherePath = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path -LiteralPath $vswherePath)) {
    throw 'Can Visual Studio Build Tools voi C++ de chay host tests.'
}
$vsInstall = & $vswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vsInstall) { throw 'Khong tim thay MSVC C++ toolchain.' }
$vcvarsPath = Join-Path $vsInstall 'VC/Auxiliary/Build/vcvars64.bat'
New-Item -ItemType Directory -Force -Path $outputDir | Out-Null
$exePath = Join-Path $outputDir 'firmware_test.exe'
$objectPath = Join-Path $outputDir 'firmware_test.obj'
$sourcePath = Join-Path $testDir 'firmware_test.cpp'
$runnerPath = Join-Path $outputDir 'run.cmd'
@"
@echo off
call "$vcvarsPath" >nul
if errorlevel 1 exit /b %errorlevel%
cl /nologo /EHsc /std:c++14 /W4 /utf-8 /I"$testDir" /I"$projectDir\include" "$sourcePath" /Fe:"$exePath" /Fo:"$objectPath"
if errorlevel 1 exit /b %errorlevel%
"$exePath"
exit /b %errorlevel%
"@ | Set-Content -LiteralPath $runnerPath -Encoding ascii
& $env:ComSpec /d /c $runnerPath
if ($LASTEXITCODE -ne 0) { throw "Host tests failed (exit $LASTEXITCODE)." }
