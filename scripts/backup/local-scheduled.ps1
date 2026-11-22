#requires -Version 5.1
<#
Encrypted local scheduled backup for the Sparkling Standard master workspace.

What it does:
  1. Refreshes a production D1 export with wrangler when possible; otherwise uses
     the newest verified local D1 export and records that fact.
  2. Creates one AES-256-GCM encrypted archive of the legal registry, I-9
     controls, restricted I-9 records folder and website source. Secrets and
     local runtime state are excluded.
  3. Verifies the archive locally.
  4. Uploads the archive, encrypted manifest and checksum to private OneDrive.
  5. Optionally downloads the uploaded copy and performs an isolated restore test.
  6. Applies retention (default 7 daily / 4 weekly / 6 monthly).
  7. Writes a machine-readable status record and a failure alert file.

The encryption key is decrypted from the existing DPAPI file only in this
process. It is never printed or written to a log.

Usage:
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/backup/local-scheduled.ps1
  powershell ... -RoundTrip -RestoreTest
  powershell ... -SkipUpload
#>
param(
  [string]$Master = 'C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER',
  [string]$Repo = 'C:\Users\thoma\Documents\Sparkling-Standard-Master\01-Website-Repository',
  [string]$OutRoot = 'C:\Users\thoma\Downloads\SPARKLING STANDARD - MASTER\08 BACKUPS & ARCHIVE\SCHEDULED',
  [string]$D1Database = 'sparkling-standard-operations',
  [string]$OneDriveFolder = 'Sparkling-Standard-Encrypted-Backups',
  [switch]$SkipUpload,
  [switch]$RoundTrip,
  [switch]$RestoreTest,
  [switch]$SkipRetentionApply,
  [int]$DailyRetention = 7,
  [int]$WeeklyRetention = 4,
  [int]$MonthlyRetention = 6
)

$ErrorActionPreference = 'Stop'
$started = (Get-Date).ToUniversalTime()
$alertDir = Join-Path $Master '08 BACKUPS & ARCHIVE\ALERTS'
$logDir = Join-Path $OutRoot 'logs'
New-Item -ItemType Directory -Path $OutRoot, $alertDir, $logDir -Force | Out-Null
$stamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$logFile = Join-Path $logDir "backup-$stamp.log"
$statusFile = Join-Path $alertDir 'LAST-RUN.json'
$failureFile = Join-Path $alertDir "BACKUP-FAILURE-$stamp.txt"
$status = [ordered]@{
  version = 1
  startedAt = $started.ToString('o')
  finishedAt = $null
  ok = $false
  archive = $null
  archiveSha256 = $null
  fileCount = $null
  plainBytes = $null
  d1 = @{ status = 'not_attempted'; path = $null; sha256 = $null }
  upload = $null
  roundTrip = $null
  restoreTest = $null
  retention = $null
  error = $null
}

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date).ToUniversalTime().ToString('o'), $Message
  Add-Content -LiteralPath $logFile -Value $line -Encoding UTF8
  Write-Host $line
}

function Run-Node([string[]]$Arguments) {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & node @Arguments 2>&1 | ForEach-Object { [string]$_ }
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  foreach ($line in $output) { Write-Log $line }
  if ($code -ne 0) { throw "node command failed ($code): $($Arguments -join ' ')" }
  return ($output -join "`n")
}

function Get-Sha256([string]$Path) {
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Send-OptionalAlert([string]$Subject, [string]$Body) {
  # Optional email alert. The owner may set these process/user environment
  # variables; no secret is stored in this script or in the status file.
  $resend = [Environment]::GetEnvironmentVariable('RESEND_API_KEY','Process')
  if (-not $resend) { $resend = [Environment]::GetEnvironmentVariable('RESEND_API_KEY','User') }
  if (-not $resend) { return }
  $from = [Environment]::GetEnvironmentVariable('RESEND_FROM_EMAIL','Process')
  if (-not $from) { $from = [Environment]::GetEnvironmentVariable('RESEND_FROM_EMAIL','User') }
  $to = [Environment]::GetEnvironmentVariable('OWNER_NOTIFICATION_EMAIL','Process')
  if (-not $to) { $to = [Environment]::GetEnvironmentVariable('OWNER_NOTIFICATION_EMAIL','User') }
  if (-not $from -or -not $to) { return }
  try {
    $payload = @{ from = $from; to = @($to); subject = $Subject; text = $Body } | ConvertTo-Json -Depth 4
    Invoke-RestMethod -Uri 'https://api.resend.com/emails' -Method Post -TimeoutSec 30 `
      -Headers @{ Authorization = "Bearer $resend"; 'Content-Type' = 'application/json' } -Body $payload | Out-Null
    Write-Log 'Optional owner email alert accepted by the provider.'
  } catch {
    Write-Log "Optional owner email alert failed: $($_.Exception.Message)"
  }
}

$keyFile = Join-Path $Master '08 BACKUPS & ARCHIVE\keys\d1-backup-key-dpapi.txt'
$secureKey = $null
$keyPtr = [IntPtr]::Zero
try {
  if (-not (Test-Path -LiteralPath $keyFile)) { throw "Backup key file not found: $keyFile" }
  if (-not (Test-Path -LiteralPath (Join-Path $Repo 'scripts\backup\create.mjs'))) { throw 'Backup scripts are unavailable in the repository.' }
  $secureKey = Get-Content -LiteralPath $keyFile | ConvertTo-SecureString
  $keyPtr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureKey)
  $env:BACKUP_ENCRYPTION_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($keyPtr)

  # 1. D1 export. Prefer a fresh remote export. A cached verified export is
  #    accepted only with an explicit status so the health check can alert.
  $d1Path = $null
  $freshD1 = Join-Path $OutRoot "d1-$stamp.sql"
  try {
    Write-Log 'Attempting fresh D1 export with wrangler.'
    $wranglerArgs = @('--yes', 'wrangler@4', 'd1', 'export', $D1Database, '--remote', '--output', $freshD1)
    $env:CI = 'true'
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $wrOutput = & npx @wranglerArgs 2>&1 | ForEach-Object { [string]$_ }
      $wrCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousErrorAction
      Remove-Item Env:CI -ErrorAction SilentlyContinue
    }
    foreach ($line in $wrOutput) { Write-Log $line }
    if ($wrCode -eq 0 -and (Test-Path -LiteralPath $freshD1) -and (Get-Item -LiteralPath $freshD1).Length -gt 0) {
      $d1Path = $freshD1
      $status.d1.status = 'fresh'
      $status.d1.path = $d1Path
      $status.d1.sha256 = Get-Sha256 $d1Path
      Write-Log "Fresh D1 export ready: $($status.d1.sha256)."
      $verifyOut = Run-Node @('scripts/backup/verify-d1-export.mjs', $d1Path)
      if ($verifyOut -notmatch '"ok": true') { throw 'Fresh D1 export failed independent verification.' }
    } else {
      Write-Log 'Fresh D1 export did not complete; looking for the newest cached export.'
    }
  } catch {
    Remove-Item Env:CI -ErrorAction SilentlyContinue
    Write-Log "Fresh D1 export failed: $($_.Exception.Message)"
  }
  if (-not $d1Path) {
    $candidates = @()
    $backupOut = Join-Path $Repo 'backup-out'
    if (Test-Path -LiteralPath $backupOut) {
      $candidates = Get-ChildItem -LiteralPath $backupOut -Filter 'd1-*.sql' -File | Sort-Object LastWriteTime -Descending
    }
    if ($candidates.Count -gt 0) {
      $d1Path = $candidates[0].FullName
      $status.d1.status = 'cached'
      $status.d1.path = $d1Path
      $status.d1.sha256 = Get-Sha256 $d1Path
      Write-Log "Using cached D1 export from $($candidates[0].LastWriteTime.ToString('o')): $($status.d1.sha256)."
    } else {
      $status.d1.status = 'unavailable'
      throw 'No fresh or cached D1 export is available; refusing to create a misleading D1 backup.'
    }
  }

  # 2. Create the encrypted local archive. No secrets or local runtime state.
  $createArgs = @(
    'scripts/backup/create.mjs',
    '--d1', $d1Path,
    '--source', "legal=$Master\00 START HERE\LEGAL-REVIEW",
    '--source', "final-legal=$Master\FINAL-APPROVAL-PACKAGE-2026-11-22",
    '--source', "i9-control=$Master\05 EMPLOYEES & TRAINING\Employee Policies\I-9",
    '--source', "i9-records=$Master\05 EMPLOYEES & TRAINING\Employee Records\I-9",
    '--source', "website=$Repo",
    '--exclude', '.env',
    '--exclude', '.dev.vars',
    '--exclude', '.wrangler',
    '--exclude', 'secrets.env',
    '--out', $OutRoot
  )
  Write-Log 'Creating encrypted archive.'
  Run-Node $createArgs | Out-Null
  $lastPath = Join-Path $OutRoot 'last-backup.json'
  if (-not (Test-Path -LiteralPath $lastPath)) { throw 'create.mjs did not write last-backup.json.' }
  $last = Get-Content -LiteralPath $lastPath -Raw | ConvertFrom-Json
  $archive = [string]$last.archive
  if (-not (Test-Path -LiteralPath $archive)) { throw 'Archive file is missing.' }
  $status.archive = $archive
  $status.archiveSha256 = Get-Sha256 $archive
  $status.fileCount = $last.fileCount
  $status.plainBytes = $last.plainBytes
  Write-Log "Archive created: $($status.fileCount) files, $($status.plainBytes) bytes."

  $verifyOut = Run-Node @('scripts/backup/verify.mjs', $archive)
  if ($verifyOut -notmatch '"ok": true') { throw 'Archive verification failed.' }
  Write-Log 'Archive local verification passed.'

  # 3. Upload to private OneDrive.
  if (-not $SkipUpload) {
    $env:ONEDRIVE_TARGET_MODE = 'existing'
    $env:ONEDRIVE_FOLDER = $OneDriveFolder
    Write-Log 'Uploading encrypted archive to OneDrive.'
    $uploadOut = Run-Node @('scripts/backup/onedrive.mjs', 'upload', '--archive', $archive)
    $status.upload = 'accepted'
    Write-Log 'OneDrive upload completed.'
    if ($RoundTrip) {
      $name = Split-Path -Leaf $archive
      $rtDir = Join-Path $OutRoot 'roundtrip'
      New-Item -ItemType Directory -Path $rtDir -Force | Out-Null
      $rtPath = Join-Path $rtDir $name
      if (Test-Path -LiteralPath $rtPath) { Remove-Item -LiteralPath $rtPath -Force }
      Run-Node @('scripts/backup/onedrive.mjs', 'download', '--name', $name, '--out', $rtPath) | Out-Null
      $remoteHash = Get-Sha256 $rtPath
      if ($remoteHash -ne $status.archiveSha256) { throw 'Independent OneDrive download hash does not match.' }
      Run-Node @('scripts/backup/verify.mjs', $rtPath) | Out-Null
      $status.roundTrip = 'hash_and_verify_passed'
      Write-Log 'Independent OneDrive download hash and verify passed.'
      if ($RestoreTest) {
        $restoreDir = Join-Path $env:TEMP "ss-backup-restore-$stamp"
        if (Test-Path -LiteralPath $restoreDir) { Remove-Item -LiteralPath $restoreDir -Recurse -Force }
        try {
          Run-Node @('scripts/backup/restore.mjs', $rtPath, '--out', $restoreDir) | Out-Null
          $restoredD1 = Get-ChildItem -LiteralPath $restoreDir -Filter 'd1-*.sql' -Recurse -File | Select-Object -First 1
          if ($restoredD1) {
            $restoreVerify = Run-Node @('scripts/backup/verify-d1-export.mjs', $restoredD1.FullName)
            if ($restoreVerify -notmatch '"ok": true') { throw 'Restored D1 export failed verification.' }
          }
          $status.restoreTest = 'passed'
          Write-Log 'Isolated restore test passed.'
        } finally {
          if (Test-Path -LiteralPath $restoreDir) { Remove-Item -LiteralPath $restoreDir -Recurse -Force }
        }
      }
    }
  } else {
    $status.upload = 'skipped'
    Write-Log 'OneDrive upload skipped by parameter.'
  }

  # 4. Retention: newest, pre-migration and legal-hold bundles are preserved.
  if (-not $SkipRetentionApply -and -not $SkipUpload) {
    $env:ONEDRIVE_TARGET_MODE = 'existing'
    $env:ONEDRIVE_FOLDER = $OneDriveFolder
    Write-Log 'Applying OneDrive retention.'
    $retention = Run-Node @('scripts/backup/retention.mjs', '--daily', "$DailyRetention", '--weekly', "$WeeklyRetention", '--monthly', "$MonthlyRetention", '--apply')
    $status.retention = 'applied'
    Write-Log 'Retention applied.'
  } else {
    $status.retention = 'not_applied'
  }

  $status.ok = $true
} catch {
  $status.error = $_.Exception.Message
  Write-Log "BACKUP FAILED: $($status.error)"
  $alertBody = @(
    'Sparkling Standard encrypted backup failed.',
    "Time: $($started.ToString('o'))",
    "Error: $($status.error)",
    "Log: $logFile",
    'No production data was changed. Investigate before the next scheduled run.'
  ) -join "`r`n"
  Set-Content -LiteralPath $failureFile -Value $alertBody -Encoding UTF8
  Send-OptionalAlert 'Sparkling Standard backup FAILED' $alertBody
  exit 1
} finally {
  if ($keyPtr -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($keyPtr) }
  Remove-Item Env:BACKUP_ENCRYPTION_KEY -ErrorAction SilentlyContinue
  Remove-Item Env:ONEDRIVE_TARGET_MODE -ErrorAction SilentlyContinue
  Remove-Item Env:ONEDRIVE_FOLDER -ErrorAction SilentlyContinue
  $status.finishedAt = (Get-Date).ToUniversalTime().ToString('o')
  ($status | ConvertTo-Json -Depth 6) | Set-Content -LiteralPath $statusFile -Encoding UTF8
  if (-not $status.ok) {
    Write-Log "Failure status written to $statusFile"
  }
}
