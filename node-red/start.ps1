$ErrorActionPreference = 'Stop'
$projectDir = Split-Path -Parent $PSScriptRoot
$runtimeDir = Join-Path $projectDir '.pio/node-red-runtime'
$runtimeScript = Join-Path $runtimeDir 'node_modules/node-red/red.js'
$dataDir = Join-Path $projectDir '.pio/node-red-data'
$env:DT45_LOG_FILE = Join-Path $PSScriptRoot 'logs/events.jsonl'
if (-not $env:DT45_DB_FILE) { $env:DT45_DB_FILE = Join-Path $PSScriptRoot 'data/dt45.sqlite' }
if (-not $env:DT45_CONTROL_TOKEN) { $env:DT45_CONTROL_TOKEN = [guid]::NewGuid().ToString('N') }
# Token Telegram de rieng trong telegram.local.ps1 (khong dua len slide/GitHub). Xem telegram.local.example.ps1.
$telegramConfig = Join-Path $PSScriptRoot 'telegram.local.ps1'
if (Test-Path -LiteralPath $telegramConfig) { . $telegramConfig }
$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { Write-Warning 'CSDL lich su can Node.js 22.5+ (khuyen nghi 24 LTS). Node cu van chay nhung khong luu CSDL.' }
if (-not (Test-Path -LiteralPath $runtimeScript)) {
    & npm.cmd install --prefix $runtimeDir node-red@4.1.7 --no-audit --no-fund --cache (Join-Path $projectDir '.pio/npm-cache')
    if ($LASTEXITCODE -ne 0) { throw 'Khong cai duoc Node-RED. Kiem tra Node.js/npm va Internet.' }
}
New-Item -ItemType Directory -Force -Path $dataDir | Out-Null
Write-Host 'Node-RED: http://127.0.0.1:1880 - Ctrl+C de dung.'
Write-Host 'Dashboard: http://127.0.0.1:1880/dashboard'
Write-Host "Ma dieu khien dashboard: $env:DT45_CONTROL_TOKEN"
Write-Host 'Nhap ma vao Mo dieu khien tren dashboard. Ma chi dung trong phien chay nay.'
Write-Host "CSDL lich su (SQLite): $env:DT45_DB_FILE"
if ($env:DT45_TELEGRAM_TOKEN) {
    $chatCount = @(($env:DT45_TELEGRAM_CHAT_ID -split '[,; ]') | Where-Object { $_ }).Count
    Write-Host "Telegram: BAT - $chatCount chat duoc phep dieu khien. Nhan /help cho bot de thu."
} else {
    Write-Host 'Telegram: TAT - sao chep node-red\telegram.local.example.ps1 thanh telegram.local.ps1 va dien token.'
}
& node $runtimeScript --userDir $dataDir --settings (Join-Path $PSScriptRoot 'settings.js') (Join-Path $PSScriptRoot 'flows.json')
exit $LASTEXITCODE
