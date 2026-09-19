# ClassIntra icon full-bleed trim tool
# Project rule: icon assets must be FULL-BLEED (content fills 100% of the canvas,
# no transparent padding). Rounded corners are applied by the AppIcon container CSS,
# never baked into the asset. This tool detects the alpha bounding box of each icon,
# crops the content and scales it back to the full canvas.
#
# Usage:
#   .\scripts\icon-trim.ps1                       # process Resources/public/icons (default)
#   .\scripts\icon-trim.ps1 -Dir <path>           # process another icon directory
#
# Handles:
#   - .png        : alpha-bbox crop + bicubic rescale to full canvas
#   - .svg        : embedded base64 PNG re-processed and re-embedded in place
#
# Notes:
#   - Fully transparent images are skipped
#   - Already full-bleed images are reported and left untouched
#   - Files over 480KB are skipped: the pre-commit hook blocks new content over
#     500KB, and System.Drawing re-encoding usually GROWS embedded-bitmap SVGs
#     (legacy oversized assets must be downscaled first, not re-encoded here)

param(
  [string]$Dir = ""
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not $Dir) {
  $Dir = Join-Path $PSScriptRoot "..\Resources\public\icons"
}
$Dir = (Resolve-Path $Dir).Path
Write-Host "Icon dir: $Dir"

function Trim-Bitmap([System.Drawing.Bitmap]$bmp, [string]$label) {
  $w = $bmp.Width; $h = $bmp.Height
  $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $bytes = New-Object byte[] ($w * $h * 4)
  [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $bytes, 0, $bytes.Length)
  $bmp.UnlockBits($data)

  $minX = $w; $minY = $h; $maxX = -1; $maxY = -1
  for ($y = 0; $y -lt $h; $y++) {
    $rowOff = $y * $w * 4
    for ($x = 0; $x -lt $w; $x++) {
      if ($bytes[$rowOff + $x * 4 + 3] -gt 8) {
        if ($x -lt $minX) { $minX = $x }
        if ($x -gt $maxX) { $maxX = $x }
        if ($y -lt $minY) { $minY = $y }
        if ($y -gt $maxY) { $maxY = $y }
      }
    }
  }
  if ($maxX -lt 0) { Write-Host "$label : fully transparent, skip"; return $null }
  $cw = $maxX - $minX + 1; $ch = $maxY - $minY + 1
  if ($minX -eq 0 -and $minY -eq 0 -and $cw -eq $w -and $ch -eq $h) { Write-Host "$label : already full-bleed, skip"; return $null }

  $dst = New-Object System.Drawing.Bitmap($w, $h)
  $g = [System.Drawing.Graphics]::FromImage($dst)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $srcRect = New-Object System.Drawing.Rectangle($minX, $minY, $cw, $ch)
  $dstRect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
  $g.DrawImage($bmp, $dstRect, $srcRect, [System.Drawing.GraphicsUnit]::Pixel)
  $g.Dispose()
  Write-Host ("{0} : margin({1},{2}) content {3}x{4} -> full {5}x{6}" -f $label, $minX, $minY, $cw, $ch, $w, $h)
  return $dst
}

Get-ChildItem "$Dir\*.png" | ForEach-Object {
  if ($_.Length -gt 480KB) { Write-Host "$($_.Name) : over 480KB (commit limit), skip"; return }
  $bmp = [System.Drawing.Bitmap]::FromFile($_.FullName)
  $out = Trim-Bitmap $bmp $_.Name
  $bmp.Dispose()
  if ($out) {
    $tmp = $_.FullName + ".tmp"
    $out.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
    $out.Dispose()
    Move-Item -Force $tmp $_.FullName
  }
}

Get-ChildItem "$Dir\*.svg" | ForEach-Object {
  if ($_.Length -gt 480KB) { Write-Host "$($_.Name) : over 480KB (commit limit), skip"; return }
  $text = [IO.File]::ReadAllText($_.FullName)
  if ($text -notmatch '(xlink:)?href="data:image/png;base64,([^"]+)"') {
    Write-Host "$($_.Name) : no embedded png, skip"
    return
  }
  $oldB64 = $Matches[2]
  $srcBytes = [Convert]::FromBase64String($oldB64)
  $ms = New-Object IO.MemoryStream(,$srcBytes)
  $bmp = [System.Drawing.Bitmap]::FromStream($ms)
  $out = Trim-Bitmap $bmp $_.Name
  $bmp.Dispose(); $ms.Dispose()
  if (-not $out) { return }
  $outMs = New-Object IO.MemoryStream
  $out.Save($outMs, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
  $newB64 = [Convert]::ToBase64String($outMs.ToArray())
  $outMs.Dispose()
  $text = $text.Replace($oldB64, $newB64)
  [IO.File]::WriteAllText($_.FullName, $text)
  Write-Host "$($_.Name) : embedded png re-embedded"
}
Write-Host "ALL DONE"
