param(
    [ValidateRange(1024, 65535)]
    [int]$Port = 3010
)

$ErrorActionPreference = 'Stop'
$terraRoot = Split-Path -Parent $PSScriptRoot
$terraSite = Join-Path $terraRoot 'site'
$terraUrl = "http://127.0.0.1:$Port"

function Test-TerraReady {
    try {
        $terraResponse = Invoke-RestMethod -Uri "$terraUrl/api/archive/status" -TimeoutSec 5
        return $terraResponse.ready -eq $true -and $terraResponse.policyId -eq 'global-only-v1'
    } catch {
        return $false
    }
}

if (Test-TerraReady) {
    Write-Output "Terra Archive is already running: $terraUrl/search"
    exit 0
}

# Do not replace another service or leave a second server on the same port.
$terraProbe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
try {
    $terraProbe.Start()
} catch {
    throw "Port $Port is in use, but Terra Archive is not ready. Check the existing process and site/outputs/local-server logs."
} finally {
    $terraProbe.Stop()
}

$terraBuild = Join-Path $terraSite '.next/BUILD_ID'
$terraNext = Join-Path $terraSite 'node_modules/next/dist/bin/next'
if (-not (Test-Path -LiteralPath $terraBuild) -or -not (Test-Path -LiteralPath $terraNext)) {
    throw 'A production build is required. Run npm.cmd run build from the site directory first.'
}
$terraNode = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$terraLogs = Join-Path $terraSite 'outputs/local-server'
New-Item -ItemType Directory -Path $terraLogs -Force | Out-Null
$terraRun = "${Port}-$([DateTime]::UtcNow.ToString('yyyyMMdd-HHmmss-fff'))"
$terraOut = Join-Path $terraLogs "$terraRun.stdout.log"
$terraErr = Join-Path $terraLogs "$terraRun.stderr.log"
$terraArguments = @('--preserve-symlinks', '--preserve-symlinks-main', ('"{0}"' -f $terraNext), 'start', '--hostname', '127.0.0.1', '--port', "$Port")

# A hidden independent process with file-backed logs survives the calling shell.
$terraProcess = Start-Process -FilePath $terraNode -ArgumentList $terraArguments -WorkingDirectory $terraSite -WindowStyle Hidden -RedirectStandardOutput $terraOut -RedirectStandardError $terraErr -PassThru
[ordered]@{
    pid = $terraProcess.Id
    port = $Port
    url = "$terraUrl/search"
    startedAtUtc = [DateTime]::UtcNow.ToString('o')
    stdout = $terraOut
    stderr = $terraErr
} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $terraLogs "${Port}.json") -Encoding UTF8

$terraDeadline = [DateTime]::UtcNow.AddSeconds(30)
do {
    if ($terraProcess.HasExited) {
        Get-Content -LiteralPath $terraErr -Tail 20 | Write-Output
        throw "Terra Archive exited with code $($terraProcess.ExitCode). See $terraErr"
    }
    if (Test-TerraReady) {
        Write-Output "Terra Archive is ready: $terraUrl/search"
        Write-Output "Background PID: $($terraProcess.Id); logs: $terraLogs"
        exit 0
    }
    Start-Sleep -Milliseconds 300
} while ([DateTime]::UtcNow -lt $terraDeadline)
throw "Terra Archive did not become ready within 30 seconds. See $terraOut and $terraErr"
