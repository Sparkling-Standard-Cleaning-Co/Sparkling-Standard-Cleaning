# Verifies the editable PowerPoint masters open in PowerPoint and exports each
# first slide as a PNG. Run only when PowerPoint is not already open.
#
#   powershell -File scripts/print/verify-pptx.ps1 [-MastersDir <dir>] [-OutDir <dir>]
param(
  [string]$MastersDir = "$env:USERPROFILE\Downloads\Door Knocking - Stage 2 Review\Editable-Masters",
  [string]$OutDir = "$env:TEMP\opencode\pptx-verify"
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

if (Get-Process POWERPNT -ErrorAction SilentlyContinue) {
  throw "PowerPoint is already running; close it before running this check."
}

$app = New-Object -ComObject PowerPoint.Application
$app.Visible = -1 # msoTrue
$results = @()
try {
  foreach ($file in Get-ChildItem -Path $MastersDir -Filter *.pptx | Sort-Object Name) {
    $pres = $app.Presentations.Open($file.FullName, -1, 0, 0) # ReadOnly, no window
    $w = [double]$pres.PageSetup.SlideWidth
    $h = [double]$pres.PageSetup.SlideHeight
    $png = Join-Path $OutDir ($file.BaseName + ".png")
    $pres.Slides.Item(1).Export($png, "PNG", [int]($w * 2), [int]($h * 2))
    $results += ("{0}`t{1}x{2} pt`t{3}x{4} in`t{5}" -f $file.Name, [int]$w, [int]$h, [math]::Round($w / 72, 2), [math]::Round($h / 72, 2), (Test-Path $png))
    $pres.Close()
  }
} finally {
  $app.Quit()
}
$results | ForEach-Object { Write-Output $_ }
