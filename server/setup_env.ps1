$Secret = ""
$c = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$b = New-Object byte[] 32
$c.GetBytes($b)
$c.Dispose()
$Secret = [BitConverter]::ToString($b) -replace '-'

$envContent = @"
# Server
PORT=4000
HOST=127.0.0.1

# PostgreSQL (local install, trust auth for localhost)
DATABASE_URL=postgresql://postgres@127.0.0.1:5432/postgres

# Admin bootstrap (first run; no registration)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123

# JWT signing secret (regenerate on each deploy)
JWT_SECRET=$Secret

# Logging
LOG_LEVEL=info
"@
$envContent | Out-File -FilePath "D:/Develop/knowledge-app/server/.env" -Encoding UTF8
Write-Host "JWT_SECRET: $Secret"
Write-Host ".env written."
