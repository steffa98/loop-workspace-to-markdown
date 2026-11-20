# Builds the Chrome Web Store upload: dist/loop-workspace-to-markdown-<version>.zip with only the extension's files.
# Run: powershell -File package.ps1
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

$version = (Get-Content manifest.json -Raw | ConvertFrom-Json).version
$files = @(
  'manifest.json', 'background.js', 'export-core.js', 'popup.html', 'popup-simple.js',
  'markdown-generator.html', 'markdown-generator.js', 'loop-markdown.js', 'jszip.min.js',
  'print-blocker.js', 'icons/icon16.png', 'icons/icon48.png', 'icons/icon128.png'
)
foreach ($f in $files) { if (-not (Test-Path $f)) { throw "Missing $f" } }

New-Item -ItemType Directory -Force dist | Out-Null
$zipPath = Join-Path $PSScriptRoot "dist/loop-workspace-to-markdown-$version.zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }
# Entries written one by one: Compress-Archive in Windows PowerShell stores "icons\x.png" with a backslash,
# which the Chrome Web Store doesn't accept
$zip = [IO.Compression.ZipFile]::Open($zipPath, 'Create')
try {
  foreach ($f in $files) {
    [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $PSScriptRoot $f), $f, 'Optimal') | Out-Null
  }
} finally {
  $zip.Dispose()
}
Write-Output "Wrote dist/loop-workspace-to-markdown-$version.zip"
