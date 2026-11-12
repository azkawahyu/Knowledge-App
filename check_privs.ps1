$user = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$adm = [Security.Principal.WindowsPrincipal]::new($user)
Write-Host "Current user: $($user.Name)"
Write-Host "IsAdmin: $($adm.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))"
Write-Host "Elevated: $($user.IsElevated)"
$exe = "C:\Users\PC_DEV\Downloads\installer.exe"
if (Test-Path $exe) { Write-Host "installer.exe exists, size: $((Get-Item $exe).Length)" }
$log = "C:\Users\PC_DEV\Downloads\installer_run.log"
if (Test-Path $log) {
    Write-Host "=== installer_run.log ==="
    Get-Content $log -Tail 60
} else { Write-Host "no installer_run.log" }
