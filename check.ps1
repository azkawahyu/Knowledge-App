$path = "C:\Users\PC_DEV\Downloads\installer.exe"
$total = 413001200
if (Test-Path $path) {
    $size = (Get-Item $path).Length
    $pct = [math]::Floor($size / $total * 100)
    Write-Host "size: $size  ($pct%)"
    if ($size -ge 412000000) {
        Write-Host "INSTALLER_COMPLETE"
        exit 0
    } else {
        exit 1
    }
} else {
    Write-Host "not-started"
    exit 2
}
