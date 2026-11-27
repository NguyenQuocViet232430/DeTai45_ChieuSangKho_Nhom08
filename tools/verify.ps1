param([switch]$SkipNetwork,[switch]$SkipBuild)
$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    $stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
    $resultDir=Join-Path $projectRoot ".pio/final-checks/$stamp"
    New-Item -ItemType Directory -Force -Path $resultDir | Out-Null
    $results=@()
    function Run-Check([string]$Name,[string]$Executable,[string[]]$Arguments) {
        $savedPreference=$ErrorActionPreference
        try {
            $ErrorActionPreference='Continue'
            $output=& $Executable @Arguments 2>&1
            $exitCode=$LASTEXITCODE
        } finally { $ErrorActionPreference=$savedPreference }
        $output | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $resultDir "$Name.log")
        $output | ForEach-Object { Write-Host $_ }
        $script:results += [pscustomobject]@{name=$Name;exit_code=$exitCode;status=$(if ($exitCode -eq 0) {'PASS'} else {'FAIL'})}
        $script:results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $resultDir 'results.json')
        if ($exitCode -ne 0) { throw "$Name failed ($exitCode). See $resultDir" }
    }
    Run-Check 'flow-export' 'node' @('.\node-red\build-flow.cjs')
    if (-not $SkipBuild) {
        $pioCommand=Get-Command pio -ErrorAction SilentlyContinue
        $pioExe=if ($pioCommand) {$pioCommand.Source} else {Join-Path $env:USERPROFILE '.platformio/penv/Scripts/platformio.exe'}
        if (-not (Test-Path -LiteralPath $pioExe)) { throw 'Can PlatformIO. Mo terminal PlatformIO hoac dung -SkipBuild.' }
        Run-Check 'esp32-build' $pioExe @('run')
    }
    Run-Check 'firmware-host' 'powershell' @('-ExecutionPolicy','Bypass','-File','.\test\run_host_tests.ps1')
    Run-Check 'node-red' 'node' @('.\test\node_red_test.cjs')
    Run-Check 'dashboard' 'node' @('.\test\dashboard_test.cjs')
    Run-Check 'log-summary' 'node' @('.\test\log_summary_test.cjs')
    Run-Check 'storage-telegram' 'node' @('.\test\storage_telegram_test.cjs')
    if (-not $SkipNetwork) { Run-Check 'mqtt-e2e-mock' 'node' @('.\test\e2e_week68_test.cjs') }
    $results | ConvertTo-Json -Depth 5 | Set-Content -Encoding UTF8 -LiteralPath (Join-Path $resultDir 'results.json')
    Write-Host "Checks completed. Results: $resultDir"
    if ($SkipNetwork) { Write-Host 'E2E skipped; no new network PASS is claimed.' }
} finally { Pop-Location }
