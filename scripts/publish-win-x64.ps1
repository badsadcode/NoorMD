<#
.SYNOPSIS
  Builds, tests and packages NoorMD for Windows x64.

.DESCRIPTION
  Produces two zips in .\artifacts:
    NoorMD-<version>-win-x64-portable.zip   self-contained: no .NET install needed (recommended)
    NoorMD-<version>-win-x64-small.zip      framework-dependent: needs the .NET 10 Desktop Runtime
  Both need the Microsoft Edge WebView2 Runtime, which is preinstalled on Windows 11 and current Windows 10.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\publish-win-x64.ps1
#>
param(
    [string]$Configuration = "Release",
    [switch]$SkipTests
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

[xml]$proj = Get-Content "src/NoorMD/NoorMD.csproj"
$version = ($proj.Project.PropertyGroup | Where-Object { $_.Version } | Select-Object -First 1).Version
$artifacts = Join-Path $root "artifacts"
New-Item -ItemType Directory -Force -Path $artifacts | Out-Null

Write-Host "== NoorMD $version ==" -ForegroundColor Magenta
dotnet --info | Select-String -Pattern "Version:" | Select-Object -First 1

if (-not $SkipTests) {
    Write-Host "== Unit tests ==" -ForegroundColor Cyan
    foreach ($t in "tests/NoorMD.Core.Tests", "tests/NoorMD.Media.Tests") {
        dotnet test $t -c $Configuration
        if ($LASTEXITCODE -ne 0) { throw "Unit tests failed: $t" }
    }
}

function Publish([string]$name, [string[]]$extra) {
    $out = Join-Path $artifacts "publish-$name"
    if (Test-Path $out) { Remove-Item -Recurse -Force $out }
    Write-Host "== Publishing $name ==" -ForegroundColor Cyan
    dotnet publish src/NoorMD/NoorMD.csproj -c $Configuration -r win-x64 -o $out -p:DebugType=none -p:GenerateDocumentationFile=false @extra
    if ($LASTEXITCODE -ne 0) { throw "Publish $name failed" }
    Get-ChildItem $out -Filter *.xml | Where-Object { $_.Name -like "Microsoft.Web.WebView2*" } | Remove-Item
    Copy-Item README.md, docs/SHORTCUTS.md, docs/MIGRATION.md -Destination $out
    $zip = Join-Path $artifacts "NoorMD-$version-win-x64-$name.zip"
    if (Test-Path $zip) { Remove-Item $zip }
    Compress-Archive -Path (Join-Path $out "*") -DestinationPath $zip -CompressionLevel Optimal
    Write-Host "   -> $zip ($([math]::Round((Get-Item $zip).Length / 1MB, 1)) MB)" -ForegroundColor Green
}

Publish "portable" @("--self-contained", "true", "-p:PublishReadyToRun=true")
Publish "small" @("--self-contained", "false")

Get-FileHash (Join-Path $artifacts "*.zip") -Algorithm SHA256 | ForEach-Object { "$($_.Hash.ToLower())  $(Split-Path -Leaf $_.Path)" } |
    Set-Content (Join-Path $artifacts "SHA256SUMS.txt")
Write-Host "Done. Unzip a package and run NoorMD.exe." -ForegroundColor Magenta
