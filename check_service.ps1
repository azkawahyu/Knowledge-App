$exe = "C:\Users\PC_DEV\Downloads\installer.exe"
$log   = "C:\Users\PC_DEV\Downloads\installer.log"

Write-Host "== Running installer silently ==" | Out-File -Append -FilePath "C:\Users\PC_DEV\Downloads\installer_run.log"
$proc = Start-Process -FilePath $exe -ArgumentList "/S /noCert /notShowProgress /norestart /log `"$log`"" -Wait -PassThru
Write-Host "installer exit: $($proc.ExitCode)" | Out-File -Append -FilePath "C:\Users\PC_DEV\Downloads\installer_run.log"
Write-Host "installer exit: $($proc.ExitCode)"

Start-Sleep -Seconds 8

$svc = Get-Service | Where-Object { $_.Name -like '*postgres*' -or $_.DisplayName -match 'postgres|Postgres' }
if ($svc) {
    $svc | Select-Object Name, Status, StartType | Format-Table -AutoSize
} else {
    Write-Host "NO postgres service found (registry may not have it)" | Out-File -Append -FilePath "C:\Users\PC_DEV\Downloads\installer_run.log"
    $svc2 = Get-WmiObject -Query "SELECT * FROM Win32_Service WHERE Name LIKE '%postgres%'" -ErrorAction SilentlyContinue
    if ($svc2) { $svc2 | Select-Object Name, State }
    else { Write-Host "  (no matching service in WMI either)" }
}
