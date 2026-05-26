$ErrorActionPreference = 'Stop'

$scriptPath = Join-Path $PSScriptRoot '..\Export-WindsurfSession.ps1'
$tempOut = Join-Path $PSScriptRoot '..\tmp-ps51-encoding-test'
$cascadeId = '86f62e25-f2e5-4d3f-9513-b65bc750e117'

if (Test-Path -LiteralPath $tempOut) {
    Remove-Item -LiteralPath $tempOut -Recurse -Force
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath `
    -CascadeId $cascadeId `
    -OutDir $tempOut `
    -JsonOnly `
    -AsJson | Out-Null

if ($LASTEXITCODE -ne 0) {
    throw "powershell.exe export failed with exit code $LASTEXITCODE"
}

$jsonFile = Get-ChildItem -LiteralPath $tempOut -Filter '*.json' | Select-Object -First 1
if (-not $jsonFile) {
    throw 'PowerShell 5.1 export did not create a JSON file'
}

$json = Get-Content -LiteralPath $jsonFile.FullName -Raw -Encoding UTF8 | ConvertFrom-Json
$firstText = [string] $json.messages[0].Text

if ($firstText -notlike '*并打开一个有头浏览器*') {
    throw "PowerShell 5.1 export did not preserve UTF-8 Chinese text. Actual: $firstText"
}

if ($firstText -like '*å*' -or $firstText -like '*æ*') {
    throw "PowerShell 5.1 export still contains mojibake. Actual: $firstText"
}

Write-Host 'PowerShell 5.1 encoding regression test passed'
