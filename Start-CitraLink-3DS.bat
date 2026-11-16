@echo off
chcp 65001 >nul
setlocal
set "CITRALINK_DIR=%~dp0"
if "%CITRALINK_DIR:~-1%"=="\" set "CITRALINK_DIR=%CITRALINK_DIR:~0,-1%"
cd /d "%CITRALINK_DIR%"

echo ==================================================
echo   CitraLink 3DS - Auto Launcher ^& Local Bridge
echo ==================================================

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$dir = $env:CITRALINK_DIR; " ^
  "$batPath = Join-Path $dir 'Start-CitraLink-3DS.bat'; " ^
  "$regBase = 'HKCU:\Software\Classes\citralink'; " ^
  "New-Item -Path $regBase -Force | Out-Null; " ^
  "Set-ItemProperty -Path $regBase -Name '(default)' -Value 'URL:CitraLink 3DS Launcher'; " ^
  "Set-ItemProperty -Path $regBase -Name 'URL Protocol' -Value ''; " ^
  "$cmdKey = Join-Path $regBase 'shell\open\command'; " ^
  "New-Item -Path $cmdKey -Force | Out-Null; " ^
  "Set-ItemProperty -Path $cmdKey -Name '(default)' -Value ('\"' + $batPath + '\" \"%%1\"'); " ^
  "Write-Host '[1/3] Registered citralink:// protocol successfully.'; " ^
  "$fwRule = Get-NetFirewallRule -DisplayName 'CitraLink 3DS Port 3000' -ErrorAction SilentlyContinue; " ^
  "if (-not $fwRule) { " ^
  "  Write-Host '[2/3] Requesting Administrator permission once to open Port 3000 on Windows Firewall...'; " ^
  "  try { " ^
  "    $fwCmd = 'New-NetFirewallRule -DisplayName \"CitraLink 3DS Port 3000\" -Direction Inbound -LocalPort 3000 -Protocol TCP -Action Allow -Profile Any'; " ^
  "    Start-Process powershell -Verb RunAs -Wait -ArgumentList '-NoProfile','-Command',$fwCmd; " ^
  "  } catch { " ^
  "    Write-Host '[!] Firewall prompt skipped. Run manually as Admin if 3DS QR download is blocked.'; " ^
  "  } " ^
  "} else { " ^
  "  Write-Host '[2/3] Windows Firewall Port 3000 rule already exists.'; " ^
  "} " ^
  "$listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue; " ^
  "if ($listening) { " ^
  "  Write-Host '[3/3] Local Bridge is already running on Port 3000.'; " ^
  "  Start-Process 'http://localhost:3000'; " ^
  "} else { " ^
  "  Write-Host '[3/3] Starting CitraLink 3DS Local Bridge (npm run dev)...'; " ^
  "  $runCmd = if (Test-Path (Join-Path $dir 'node_modules')) { 'npm run dev' } else { 'npm install && npm run dev' }; " ^
  "  Start-Process cmd.exe -WorkingDirectory $dir -ArgumentList '/k',$runCmd; " ^
  "  Start-Sleep -Seconds 2; " ^
  "  Start-Process 'http://localhost:3000'; " ^
  "}"
