# Upgrade the existing per-user installation with independently verified record preservation.
param([string]$ResumeBackup = '')
$ErrorActionPreference = 'Stop'
$workspacePath = Split-Path -Parent $PSScriptRoot
$expectedVersion = '0.4.0'
Set-Location -LiteralPath $workspacePath
$installedPath = Join-Path $env:LOCALAPPDATA 'TempoDesk\tempodesk.exe'
$productionDatabasePath = Join-Path $env:APPDATA 'com.tempodesk.desktop\tempodesk.db'
$releasePath = Join-Path $workspacePath 'src-tauri\target\release\tempodesk.exe'
$installerPath = Join-Path $workspacePath "src-tauri\target\release\bundle\nsis\TempoDesk_${expectedVersion}_x64-setup.exe"
foreach ($requiredPath in @($installedPath, $productionDatabasePath, $releasePath, $installerPath)) {
    if (-not (Test-Path -LiteralPath $requiredPath -PathType Leaf)) { throw "Missing upgrade prerequisite: $requiredPath" }
}
if ((Get-Item -LiteralPath $releasePath).VersionInfo.ProductVersion -ne $expectedVersion) {
    throw 'Refusing to install an unexpected release version.'
}
$installerExitCode = 0
if (-not $ResumeBackup) {
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$liveBackupPath = Join-Path $workspacePath ".upgrade-backups\before-stop-$stamp"
$finalBackupPath = Join-Path $workspacePath ".upgrade-backups\installed-${expectedVersion}-$stamp"

# Take a consistent live snapshot before restarting, including data still in SQLite's WAL.
& node (Join-Path $PSScriptRoot 'upgrade-records.mjs') snapshot $productionDatabasePath $liveBackupPath
if ($LASTEXITCODE -ne 0) { throw 'Live backup failed. Upgrade has not started.' }

# Only stop processes whose path matches this exact installed executable. Timer starts are already
# persisted; closing the process keeps the active entry intact for the app's recovery flow.
$installedProcesses = @(Get-Process -Name tempodesk -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installedPath })
foreach ($installedProcess in $installedProcesses) {
    & taskkill /PID $installedProcess.Id /T /F
    if ($LASTEXITCODE -ne 0) { throw 'Could not close the installed app for upgrade.' }
}
if (@(Get-Process -Name tempodesk -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $installedPath }).Count -gt 0) {
    throw 'Installed app is still running. Program files have not been changed.'
}

# Refresh the backup after closing so the final manifest covers every committed record at install.
& node (Join-Path $PSScriptRoot 'upgrade-records.mjs') snapshot $productionDatabasePath $finalBackupPath
if ($LASTEXITCODE -ne 0) { throw 'Final backup failed. Program files have not been changed.' }
$snapshotPath = Join-Path $finalBackupPath 'tempodesk-before-upgrade.db'
$manifestPath = Join-Path $finalBackupPath 'records.json'
& node (Join-Path $PSScriptRoot 'upgrade-records.mjs') trial-copy $snapshotPath $manifestPath
if ($LASTEXITCODE -ne 0) { throw 'Migration trial copy failed.' }
$migrationPath = Join-Path $finalBackupPath 'migration-trial.db'
& cargo run --quiet --manifest-path (Join-Path $workspacePath 'core\Cargo.toml') --example upgrade_guard -- $migrationPath
if ($LASTEXITCODE -ne 0) { throw 'Migration rehearsal failed. Program files have not been changed.' }
& node (Join-Path $PSScriptRoot 'upgrade-records.mjs') verify $migrationPath $manifestPath
if ($LASTEXITCODE -ne 0) { throw 'Migration rehearsal changed a record. Program files have not been changed.' }

# NSIS /UPDATE bypasses uninstall and app-data removal. /S avoids installer prompts.
$installerProcess = Start-Process -FilePath $installerPath -ArgumentList @('/S', '/UPDATE') -WindowStyle Hidden -PassThru -Wait
if ($installerProcess.ExitCode -notin @(0, 3010)) { throw "Installer failed with exit code $($installerProcess.ExitCode). Backups remain at $finalBackupPath" }
$installerExitCode = $installerProcess.ExitCode
} else {
    $finalBackupPath = (Resolve-Path -LiteralPath $ResumeBackup).Path
    $backupRootPath = (Resolve-Path -LiteralPath (Join-Path $workspacePath '.upgrade-backups')).Path
    if (-not $finalBackupPath.StartsWith($backupRootPath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw 'Resume requires a backup inside this workspace.'
    }
    $manifestPath = Join-Path $finalBackupPath 'records.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'Backup manifest is missing.' }
}
& node (Join-Path $PSScriptRoot 'upgrade-records.mjs') binary-verify $installedPath $releasePath
if ($LASTEXITCODE -ne 0) { throw 'Installed program verification failed.' }
$installedHash = (Get-FileHash -LiteralPath $installedPath -Algorithm SHA256).Hash
$installedVersion = (Get-Item -LiteralPath $installedPath).VersionInfo.ProductVersion
if ($installedVersion -ne $expectedVersion) { throw 'Installed program version is unexpected.' }
& node (Join-Path $PSScriptRoot 'upgrade-records.mjs') verify $productionDatabasePath $manifestPath
if ($LASTEXITCODE -ne 0) { throw 'Records changed during installation. Backups have been retained.' }

$updatedProcess = Start-Process -FilePath $installedPath -WindowStyle Hidden -PassThru
& node (Join-Path $PSScriptRoot 'upgrade-records.mjs') verify $productionDatabasePath $manifestPath --wait-for-schema=2
if ($LASTEXITCODE -ne 0) { throw 'Post-launch preservation check failed. Backups have been retained.' }
if (-not (Get-Process -Id $updatedProcess.Id -ErrorAction SilentlyContinue)) { throw 'Updated app exited unexpectedly.' }
$verification = @{
    installedVersion = $installedVersion
    installedPath = $installedPath
    sha256 = $installedHash
    installerExitCode = $installerExitCode
    processId = $updatedProcess.Id
    backupPath = $finalBackupPath
    recordsPreserved = $true
}
$verification | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $finalBackupPath 'installation-verification.json') -Encoding UTF8
$verification | ConvertTo-Json
