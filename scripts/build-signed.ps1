# Builds the installer, signs it so installed copies will accept it as an update, and
# writes latest.json. The password is asked for each time and only lasts for this build:
# it is never saved or passed on the command line.
$key = Join-Path $env:USERPROFILE ".tauri\scriptos.key"
if (-not (Test-Path $key)) {
  Write-Host "No signing key at $key" -ForegroundColor Red
  exit 1
}

$secure = Read-Host "Signing key password (nothing shows as you type)" -AsSecureString
$env:TAURI_SIGNING_PRIVATE_KEY = $key
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password

try {
  npm run app:build
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  npm run release:manifest
  exit $LASTEXITCODE
} finally {
  Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
